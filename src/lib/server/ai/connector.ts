import { serverEnv } from '$lib/server/env';
import { logger } from '$lib/server/logger';
import { AppError } from '$lib/server/problem';

/**
 * OpenAI-compatible LLM connector (story 5.3, FR33/NFR18). The ONE place an
 * outbound `fetch` to the configured endpoint happens - 5.4's generation calls
 * `chatComplete`, never `fetch`es directly. Built over the platform `fetch` (no
 * SDK, no new dependency). Talks ONLY to the operator-configured `LLM_BASE_URL`:
 * no default cloud endpoint, no phone-home.
 *
 * Two gates guard every call (the load-bearing "no call before opt-in" AC):
 * 1. CONFIGURED: LLM_BASE_URL + LLM_MODEL present (the env all-or-nothing refine
 *    guarantees they come together; LLM_API_KEY is optional for a local
 *    no-auth endpoint).
 * 2. OPTED-IN: AI_GENERATION_ENABLED is true.
 * `assertAiEnabled()` checks BOTH and throws BEFORE any `fetch` when either is
 * missing, so configuration alone never enables an outbound call.
 */

/** Default request timeout. The LLM call can be slow but must not hang forever. */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Cap on the upstream error body folded into the (server-logged) error message.
 * A hostile or misconfigured endpoint could otherwise reflect a large or
 * secret-bearing body into `err.message`, which pino's key-based redaction does
 * not scan. The body is diagnostic context only, so a bounded prefix suffices.
 */
const MAX_UPSTREAM_BODY_CHARS = 500;

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface ChatCompleteOptions {
	/** Sampling temperature passed through to the endpoint when set. */
	temperature?: number;
	/** Overrides the default request timeout (ms). */
	timeoutMs?: number;
	/** Correlates the server-side warn log with the request. */
	requestId?: string;
}

export interface ChatCompleteResult {
	/** The assistant message content from the first choice. */
	content: string;
	/** The model id the endpoint reported, when present. */
	model?: string;
}

interface AiConfig {
	baseUrl: string;
	apiKey?: string;
	model: string;
}

/**
 * Reads the LLM connection block from the validated env. Returns null when the
 * endpoint is absent (the all-or-nothing env refine guarantees base URL and
 * model are present together, so a present base URL implies a complete config).
 */
export function aiConfig(): AiConfig | null {
	const env = serverEnv();
	if (!env.LLM_BASE_URL || !env.LLM_MODEL) return null;
	return { baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL };
}

/** True only when BOTH gates hold: the endpoint is configured AND opted-in. */
export function isAiEnabled(): boolean {
	return aiConfig() !== null && serverEnv().AI_GENERATION_ENABLED;
}

/**
 * Raised when AI generation is requested while disabled - either no endpoint is
 * configured OR the opt-in is absent. The detail tells the operator HOW to
 * enable it without leaking config internals (D9). 503: the capability is
 * unavailable, mirroring `/problems/mail-not-configured`.
 */
export function aiGenerationDisabled(): AppError {
	return new AppError({
		status: 503,
		title: 'AI Generation Disabled',
		type: '/problems/ai-generation-disabled',
		detail:
			'AI generation is disabled. Set LLM_BASE_URL and LLM_MODEL (and LLM_API_KEY if the ' +
			'endpoint requires auth), set AI_GENERATION_ENABLED=true to opt in, then restart.'
	});
}

/**
 * Asserts BOTH gates before any outbound call. Throws `aiGenerationDisabled()`
 * (503) when the endpoint is unconfigured OR the opt-in is absent. The connector
 * calls this BEFORE constructing any `fetch`, so a disabled connector issues no
 * request at all (proven by test: the `fetch` mock is never called when
 * disabled).
 */
export function assertAiEnabled(): AiConfig {
	const config = aiConfig();
	if (!config || !serverEnv().AI_GENERATION_ENABLED) throw aiGenerationDisabled();
	return config;
}

/**
 * Maps a transport/HTTP/parse failure to a client-safe AppError. The raw error
 * (which can carry the endpoint host, the response body, or connection
 * internals) is logged server-side at `warn` (the LLM endpoint is a degradable
 * external dependency, like SMTP) and NEVER placed in the client-facing detail.
 * The API key NEVER reaches the logger or the detail. 502: an upstream/bad-
 * gateway failure, mirroring `/problems/mail-delivery-failed`.
 */
function generationFailed(error: unknown, requestId?: string): AppError {
	logger.warn({ requestId, err: error }, 'ai generation failed');
	return new AppError({
		status: 502,
		title: 'AI Generation Failed',
		type: '/problems/ai-generation-failed',
		detail: 'The AI endpoint could not be reached or returned an error. Check the server logs.'
	});
}

interface ChatCompletionResponse {
	choices?: Array<{ message?: { content?: string } }>;
	model?: string;
}

/**
 * POSTs an OpenAI-compatible Chat Completions request to
 * `${LLM_BASE_URL}/chat/completions` and returns the assistant message content.
 * Both gates are asserted first (503 when disabled, BEFORE any fetch). A
 * network, HTTP (non-2xx), abort/timeout, or parse failure becomes a
 * `/problems/ai-generation-failed` 502 with a redacted client detail; the full
 * error is logged server-side. The bearer header is omitted when no key is set.
 */
export async function chatComplete(
	messages: ChatMessage[],
	options: ChatCompleteOptions = {}
): Promise<ChatCompleteResult> {
	const config = assertAiEnabled();

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS);

	const headers: Record<string, string> = { 'content-type': 'application/json' };
	if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;

	const body: Record<string, unknown> = { model: config.model, messages };
	if (options.temperature !== undefined) body.temperature = options.temperature;

	try {
		const response = await fetch(`${config.baseUrl}/chat/completions`, {
			method: 'POST',
			headers,
			body: JSON.stringify(body),
			signal: controller.signal
		});

		if (!response.ok) {
			// Read the body for the server log only; it never reaches the client. Cap
			// it BEFORE it enters the error message so a hostile/misconfigured endpoint
			// cannot dump a large or secret-bearing body into the logs (NFR18).
			const raw = await response.text().catch(() => '');
			const truncated = raw.slice(0, MAX_UPSTREAM_BODY_CHARS);
			throw generationFailed(
				new Error(`AI endpoint responded ${response.status}: ${truncated}`),
				options.requestId
			);
		}

		const data = (await response.json()) as ChatCompletionResponse;
		const content = data.choices?.[0]?.message?.content;
		if (typeof content !== 'string') {
			throw generationFailed(
				new Error('AI endpoint returned no assistant message content'),
				options.requestId
			);
		}
		return { content, model: data.model };
	} catch (error) {
		if (error instanceof AppError) throw error;
		throw generationFailed(error, options.requestId);
	} finally {
		clearTimeout(timeout);
	}
}
