/**
 * The `/api/v1` endpoint wrapper (story 4.2). It is the per-endpoint companion to
 * the `/api/*` error boundary in hooks.server.ts: an endpoint throws an AppError,
 * this catches it and returns the RFC 9457 problem+json (D9) with the right
 * status - so a 404/409/422 from the service surfaces correctly, NOT as a 500.
 *
 * WHY a wrapper rather than the handle-level boundary alone: SvelteKit's internal
 * `resolve()` wraps endpoint execution in its own try/catch and routes any throw
 * through `handleError` (always a 500, serialized as an error page), BEFORE the
 * thrown value ever reaches a `handle` hook. So a `handle`-level catch cannot see
 * an endpoint throw. This wrapper catches inside the endpoint, where the throw is
 * still an AppError, and is the single seam every `/api/v1` handler composes -
 * keeping handlers thin (one `runApi(...)` call, no inline catch discipline). The
 * handle-level boundary remains the backstop for throws OUTSIDE an endpoint (the
 * auth stage), and an unexpected (non-AppError) error still falls through to the
 * opaque 500.
 */
import { AppError, problemResponse } from '$lib/server/problem';

export async function runApi(handler: () => Promise<Response>): Promise<Response> {
	try {
		return await handler();
	} catch (thrown) {
		if (thrown instanceof AppError) return problemResponse(thrown);
		throw thrown;
	}
}
