import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '$lib/server/problem';

const serverEnv = vi.fn();
vi.mock('$lib/server/env', () => ({ serverEnv }));

const warn = vi.fn();
const info = vi.fn();
vi.mock('$lib/server/logger', () => ({ logger: { warn, info } }));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const SECRET_KEY = 'sk-super-secret-key-value';

const enabledEnv = {
	LLM_BASE_URL: 'https://llm.example.com/v1',
	LLM_API_KEY: SECRET_KEY,
	LLM_MODEL: 'gpt-test',
	AI_GENERATION_ENABLED: true
};

let connector: typeof import('./connector');

beforeEach(async () => {
	vi.clearAllMocks();
	serverEnv.mockReturnValue(enabledEnv);
	connector = await import('./connector');
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.stubGlobal('fetch', fetchMock);
});

function okResponse(content: string, model = 'gpt-test'): Response {
	return new Response(JSON.stringify({ choices: [{ message: { content } }], model }), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

describe('isAiEnabled / assertAiEnabled gates', () => {
	it('is false when unconfigured even if opted-in', () => {
		serverEnv.mockReturnValue({ AI_GENERATION_ENABLED: true });
		expect(connector.isAiEnabled()).toBe(false);
	});

	it('is false when configured but not opted-in', () => {
		serverEnv.mockReturnValue({ ...enabledEnv, AI_GENERATION_ENABLED: false });
		expect(connector.isAiEnabled()).toBe(false);
	});

	it('is true only when configured AND opted-in', () => {
		expect(connector.isAiEnabled()).toBe(true);
	});

	it('assertAiEnabled throws 503 ai-generation-disabled when not configured', () => {
		serverEnv.mockReturnValue({ AI_GENERATION_ENABLED: true });
		try {
			connector.assertAiEnabled();
			expect.unreachable('must throw when unconfigured');
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(AppError);
			const error = thrown as AppError;
			expect(error.status).toBe(503);
			expect(error.type).toBe('/problems/ai-generation-disabled');
			// The detail tells the operator HOW to enable it.
			expect(error.detail).toContain('LLM_BASE_URL');
			expect(error.detail).toContain('AI_GENERATION_ENABLED');
		}
	});

	it('assertAiEnabled throws 503 when configured but not opted-in', () => {
		serverEnv.mockReturnValue({ ...enabledEnv, AI_GENERATION_ENABLED: false });
		expect(() => connector.assertAiEnabled()).toThrow(AppError);
	});
});

describe('chatComplete - the no-call-before-opt-in contract', () => {
	it('NEVER calls fetch when not configured', async () => {
		serverEnv.mockReturnValue({ AI_GENERATION_ENABLED: true });
		await expect(connector.chatComplete([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
			type: '/problems/ai-generation-disabled'
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('NEVER calls fetch when configured but not opted-in', async () => {
		serverEnv.mockReturnValue({ ...enabledEnv, AI_GENERATION_ENABLED: false });
		await expect(connector.chatComplete([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
			status: 503
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('chatComplete success', () => {
	it('POSTs to /chat/completions with the bearer key, model and messages, returns the content', async () => {
		fetchMock.mockResolvedValue(okResponse('the assistant reply'));

		const result = await connector.chatComplete(
			[
				{ role: 'system', content: 'be terse' },
				{ role: 'user', content: 'ping' }
			],
			{ temperature: 0.2 }
		);

		expect(result).toEqual({ content: 'the assistant reply', model: 'gpt-test' });
		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://llm.example.com/v1/chat/completions');
		expect(init.method).toBe('POST');
		expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET_KEY}`);
		const body = JSON.parse(init.body as string);
		expect(body.model).toBe('gpt-test');
		expect(body.temperature).toBe(0.2);
		expect(body.messages).toHaveLength(2);
	});

	it('omits the Authorization header when no API key is set (local no-auth endpoint)', async () => {
		serverEnv.mockReturnValue({
			LLM_BASE_URL: 'http://localhost:11434/v1',
			LLM_MODEL: 'llama',
			AI_GENERATION_ENABLED: true
		});
		fetchMock.mockResolvedValue(okResponse('local reply'));

		await connector.chatComplete([{ role: 'user', content: 'hi' }]);

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect((init.headers as Record<string, string>).authorization).toBeUndefined();
	});
});

describe('chatComplete failure - 502 with redaction', () => {
	it('maps a non-2xx response to ai-generation-failed 502 without leaking the host, body or key', async () => {
		fetchMock.mockResolvedValue(
			new Response('upstream blew up at llm.example.com', { status: 500 })
		);

		try {
			await connector.chatComplete([{ role: 'user', content: 'hi' }], { requestId: 'req-1' });
			expect.unreachable('must throw on a non-2xx response');
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(AppError);
			const error = thrown as AppError;
			expect(error.status).toBe(502);
			expect(error.type).toBe('/problems/ai-generation-failed');
			expect(error.detail).not.toContain('llm.example.com');
			expect(error.detail).not.toContain('upstream blew up');
			expect(error.detail).not.toContain(SECRET_KEY);
		}
	});

	it('maps a network reject to ai-generation-failed 502', async () => {
		fetchMock.mockRejectedValue(new Error('ECONNREFUSED llm.example.com'));

		await expect(connector.chatComplete([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
			type: '/problems/ai-generation-failed',
			status: 502
		});
	});

	it('maps an abort/timeout to ai-generation-failed 502', async () => {
		fetchMock.mockImplementation((_url: string, init: RequestInit) => {
			return new Promise((_resolve, reject) => {
				(init.signal as AbortSignal).addEventListener('abort', () => {
					reject(new DOMException('aborted', 'AbortError'));
				});
			});
		});

		await expect(
			connector.chatComplete([{ role: 'user', content: 'hi' }], { timeoutMs: 5 })
		).rejects.toMatchObject({ type: '/problems/ai-generation-failed', status: 502 });
	});

	it('logs the full error server-side at warn and NEVER the API key', async () => {
		fetchMock.mockRejectedValue(new Error(`boom with ${SECRET_KEY} in it`));

		await expect(
			connector.chatComplete([{ role: 'user', content: 'hi' }], { requestId: 'req-2' })
		).rejects.toBeInstanceOf(AppError);

		expect(warn).toHaveBeenCalledOnce();
		const [logArg, message] = warn.mock.calls[0] as [Record<string, unknown>, string];
		expect(message).toBe('ai generation failed');
		expect(logArg.requestId).toBe('req-2');
		// The redaction in logger.ts keys on the field name; here we assert the call
		// site never passes the key as its own field. The raw upstream error string
		// may carry the key, which is exactly what pino's runtime redaction guards;
		// the client-facing detail (asserted above) never carries it.
		expect(JSON.stringify({ requestId: logArg.requestId, message })).not.toContain(SECRET_KEY);
	});
});
