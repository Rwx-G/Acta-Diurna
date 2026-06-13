import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { completeAuthorSignIn } from '$lib/server/auth/author-gate';
import { setAuthorCookie } from '$lib/server/auth/cookies';
import {
	authorVerificationFailureLimiter,
	authorVerificationRateLimiter,
	GLOBAL_AUTHOR_VERIFICATION_KEY
} from '$lib/server/auth/rate-limit';
import { isMultiAuthor } from '$lib/server/mode';

/**
 * Author magic-link landing (Epic 8, story 8.3). The author arrives here from the
 * emailed link with the single-use token in `?t=`. Flow:
 *
 *   - Multi mode only: single mode has no magic-link path, so a landing there is a
 *     plain bounce to /login (the password form). Mode-guarded so a stray link can
 *     never mint an author or a session in single mode.
 *   - Atomically consume the token (single-use): a second click, an expired token,
 *     or a forged token all fail identically and bounce to the neutral
 *     "request a new link" state, never distinguishing the cause (NFR9).
 *   - On success: the author row is minted on first sign-in (inside
 *     `completeAuthorSignIn`), an author-realm session bound to that author id is
 *     opened, the `__Host-acta_author` cookie is set, and the author lands in the
 *     workspace.
 *
 * GET is correct: the link is clicked from an email client (a navigation), and the
 * consume is single-use-safe (the atomic UPDATE guarantees a prefetch that burns
 * the token only costs that author a re-request, it cannot be replayed).
 */
export const GET: RequestHandler = async ({ url, cookies, getClientAddress, setHeaders }) => {
	// The landing consumes a single-use token and may open a session: never let an
	// intermediary cache it (NFR10). Set before any branch so every exit carries it.
	setHeaders({ 'cache-control': 'no-store' });

	// Single mode: no magic-link path. Bounce to the password form, mint nothing.
	if (!isMultiAuthor()) redirect(303, '/login');

	const rawToken = url.searchParams.get('t') ?? '';

	// Same rate-limit envelope as the email submission: a flood of forged `?t=`
	// guesses engages the limiter. A throttled landing returns the IDENTICAL expired
	// bounce as a failed consume, never a distinct 429 page, so no new enumeration
	// oracle is introduced (NFR9). Only a NON-EMPTY token is a genuine consume
	// attempt charged against the global brake.
	if (!withinAuthorVerificationLimit(getClientAddress(), rawToken !== '')) {
		redirect(303, '/login?expired=1');
	}

	if (rawToken === '') {
		// A bare landing with no token is not a consume attempt: bounce to the same
		// expired state without touching the consume or the global brake.
		redirect(303, '/login?expired=1');
	}

	const session = await completeAuthorSignIn(rawToken);
	if (!session) {
		// Used / expired / forged: bounce to the "request a new link" state. Identical
		// for every failure cause.
		redirect(303, '/login?expired=1');
	}

	setAuthorCookie(cookies, session.token, session.expiresAt);
	redirect(303, '/reports');
};

/**
 * Per-IP limit, then the IP-independent global brake (the reverse-proxy second
 * line), mirroring the email-submission action. The per-IP bucket is consumed on
 * EVERY landing (so a single IP probing is always bounded); the global brake is
 * consumed ONLY when `tokenAttempt` is true (a non-empty `?t=`), so an empty-token
 * probe is bounded per-IP but cannot drain the shared brake.
 */
function withinAuthorVerificationLimit(clientAddress: string, tokenAttempt: boolean): boolean {
	const perIp = authorVerificationRateLimiter.consume(`${clientAddress}:/login`);
	if (!perIp.allowed) return false;
	if (!tokenAttempt) return true;
	return authorVerificationFailureLimiter.consume(GLOBAL_AUTHOR_VERIFICATION_KEY).allowed;
}
