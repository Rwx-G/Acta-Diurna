import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { completeAuthorSignIn, peekAuthorSignIn } from '$lib/server/auth/author-gate';
import { setAuthorCookie } from '$lib/server/auth/cookies';
import {
	authorVerificationFailureLimiter,
	authorVerificationRateLimiter,
	GLOBAL_AUTHOR_VERIFICATION_KEY
} from '$lib/server/auth/rate-limit';
import { isMultiAuthor } from '$lib/server/mode';

/**
 * Author magic-link landing (Epic 8, story 8.3; A1 prefetch-safe interstitial). The
 * author arrives here from the emailed link with the single-use token in `?t=`. A
 * mail-gateway link scanner (Defender SafeLinks, Proofpoint, Mimecast) GET-prefetches
 * delivered links, so a GET that consumed the token would burn it before the human
 * clicks and lock every author out (multi mode has no other auth path). The fix:
 *
 *   - The GET `load` NEVER consumes. It PEEKS (a read-only validity check) and
 *     renders a minimal interstitial with a single "Confirm sign-in" button that
 *     POSTs same-origin to consume the token and mint the session. A scanner's
 *     prefetch only renders the interstitial; the human's click still works.
 *   - The atomic single-use consume + session mint lives in the `confirm` action,
 *     unchanged from the old GET handler (15-min TTL enforced inside the consume).
 *   - Single mode: no magic-link path, so a landing is a plain bounce to /login.
 *     Mode-guarded so a stray link can never mint an author or session there.
 *   - Enumeration-neutrality (NFR9): an unknown/expired/already-consumed token PEEKS
 *     false and shows the SAME neutral expired state as a bare landing - no oracle.
 *     The same neutral state is also the consume-failure landing.
 *
 * CSRF: the confirm POST is a same-origin SvelteKit form action, so the framework's
 * built-in origin check applies (never disabled). The interstitial carries no author
 * identity, so a scanner-rendered page leaks nothing.
 */

type LoadResult = { state: 'confirm'; token: string } | { state: 'expired' };

export const load: PageServerLoad = async ({
	url,
	getClientAddress,
	setHeaders
}): Promise<LoadResult> => {
	// The landing may end in a session mint (via the confirm POST): never let an
	// intermediary cache it (NFR10). Set before any branch so every exit carries it.
	setHeaders({ 'cache-control': 'no-store' });

	// Single mode: no magic-link path. Bounce to the password form, mint nothing.
	if (!isMultiAuthor()) redirect(303, '/login');

	const rawToken = url.searchParams.get('t') ?? '';

	// Same rate-limit envelope as the email submission: a flood of forged `?t=`
	// guesses engages the limiter. A throttled landing returns the IDENTICAL expired
	// state as a failed peek, never a distinct 429 page, so no new enumeration oracle
	// is introduced (NFR9). Only a NON-EMPTY token is a genuine attempt charged
	// against the global brake. The peek does NOT consume, so a scanner prefetch costs
	// only rate-limit budget, never the token.
	if (!withinAuthorVerificationLimit(getClientAddress(), rawToken !== '')) {
		return { state: 'expired' };
	}

	if (rawToken === '') {
		// A bare landing with no token is not an attempt: show the same expired state
		// without touching the peek or the global brake.
		return { state: 'expired' };
	}

	// Read-only validity peek: render the confirm interstitial only for a live token.
	// A used/expired/forged token shows the identical neutral expired state, no leak.
	const live = await peekAuthorSignIn(rawToken);
	return live ? { state: 'confirm', token: rawToken } : { state: 'expired' };
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

export const actions: Actions = {
	confirm: async (event) => confirmSignInAction(event)
};

/**
 * Confirm action: atomically consumes the single-use token and mints the author
 * session - the exact step the old GET handler ran, now behind a same-origin POST so
 * a scanner prefetch (a GET) can never trigger it. Single-use + 15-min TTL are
 * enforced inside `completeAuthorSignIn`'s atomic consume, unchanged. A
 * used/expired/forged token (or a single mode landing) bounces to the neutral
 * "request a new link" state, identical for every cause (NFR9).
 */
async function confirmSignInAction(event: RequestEvent) {
	const { request, cookies, setHeaders } = event;
	setHeaders({ 'cache-control': 'no-store' });

	// Single mode: no magic-link path. A stray confirm POST mints nothing.
	if (!isMultiAuthor()) redirect(303, '/login');

	const data = await request.formData();
	const field = data.get('t');
	const rawToken = typeof field === 'string' ? field : '';
	if (rawToken === '') redirect(303, '/login?expired=1');

	const session = await completeAuthorSignIn(rawToken);
	if (!session) {
		// Used / expired / forged: bounce to the "request a new link" state. Identical
		// for every failure cause.
		redirect(303, '/login?expired=1');
	}

	setAuthorCookie(cookies, session.token, session.expiresAt);
	redirect(303, '/reports');
}
