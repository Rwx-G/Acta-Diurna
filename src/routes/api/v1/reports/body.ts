/**
 * Request-body parsing for the `/api/v1/reports` endpoints. The endpoints stay
 * thin adapters (story 4.2): the ONLY logic here is reading JSON and shaping the
 * concurrency token, so a malformed body becomes the standard problem+json (the
 * `/api/*` boundary formats the thrown AppError) instead of an opaque crash.
 *
 * Document validation is NOT here - it lives inside the documents service so the
 * API and the workspace share one validation contract (FR2/FR30 parity). These
 * helpers only parse transport; the service owns every business rule.
 */
import { AppError } from '$lib/server/problem';

function malformedBody(detail: string): AppError {
	return new AppError({
		status: 400,
		title: 'Malformed request body',
		type: '/problems/malformed-request',
		detail
	});
}

/** Reads the request body as a JSON object; a non-object or unparseable body is a 400. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
	let parsed: unknown;
	try {
		parsed = await request.json();
	} catch {
		throw malformedBody('The request body must be valid JSON.');
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw malformedBody('The request body must be a JSON object.');
	}
	return parsed as Record<string, unknown>;
}

/**
 * Reads the optimistic-concurrency token from the body (backlog Epic 4 decision:
 * a body field, not `If-Unmodified-Since`, to match the service signature - the
 * service takes an `expectedUpdatedAt: Date`). The field is the ISO timestamp the
 * caller last saw on the report. Absent -> undefined (last-write-wins, the same
 * behavior the workspace gets when it omits the guard). Present but not a valid
 * timestamp -> a 400, so a typo fails loudly rather than silently disabling the
 * guard.
 */
export function readExpectedUpdatedAt(body: Record<string, unknown>): Date | undefined {
	const raw = body['expectedUpdatedAt'];
	if (raw === undefined || raw === null) return undefined;
	if (typeof raw !== 'string') {
		throw malformedBody('`expectedUpdatedAt` must be an ISO 8601 timestamp string.');
	}
	const parsed = new Date(raw);
	if (Number.isNaN(parsed.getTime())) {
		throw malformedBody('`expectedUpdatedAt` must be a valid ISO 8601 timestamp.');
	}
	return parsed;
}

/**
 * Reads `expectedUpdatedAt` from a body that may be empty. Publish takes only the
 * concurrency token, so a bare POST (no body) is the common case; only a present
 * JSON object is inspected for the token, and a malformed/empty body yields
 * undefined (no guard) rather than a 400 - a publish with no concurrency intent
 * must not fail on an absent body.
 */
export async function readOptionalExpectedUpdatedAt(request: Request): Promise<Date | undefined> {
	const text = await request.text();
	if (text.trim() === '') return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
	return readExpectedUpdatedAt(parsed as Record<string, unknown>);
}
