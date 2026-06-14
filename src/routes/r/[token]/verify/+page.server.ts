import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { setReaderCookie } from '$lib/server/auth/cookies';
import {
	GLOBAL_VERIFICATION_KEY,
	verificationFailureLimiter,
	verificationRateLimiter,
	verificationShareLimiter
} from '$lib/server/auth/rate-limit';
import { isMultiAuthor } from '$lib/server/mode';
import { completeVerification, peekVerification, serveNeutralClosed } from '$lib/server/reader';
import { getShareByToken } from '$lib/server/sharing';

/**
 * Reader magic-link landing (story 3.3; A1 prefetch-safe interstitial). The reader
 * arrives here from the emailed link with the single-use verification token in `?t=`.
 * A mail-gateway link scanner (Defender SafeLinks, Proofpoint, Mimecast)
 * GET-prefetches delivered links, so a GET that consumed the token would burn it
 * before the human clicks and land them on the expired path. The fix:
 *
 *   - Resolve the share by the URL `[token]`. A closed/unknown share is the same
 *     neutral 404 as everywhere else (NFR9), BEFORE the mode branch so the leak-free
 *     posture is identical in both modes.
 *   - The GET `load` NEVER consumes. It PEEKS (a read-only validity check for THIS
 *     share) and renders a minimal interstitial with a single "Confirm and view
 *     report" button that POSTs same-origin to consume the token and open the
 *     session. A scanner's prefetch only renders the interstitial; the human's click
 *     still works.
 *   - The atomic single-use consume + session mint lives in the `confirm` action,
 *     unchanged from the old GET handler (15-min TTL enforced inside the consume).
 *   - Single mode (story 8.4): no magic-link verification, so a landing bounces to
 *     the neutral expired state, identical to a dead token.
 *   - Enumeration-neutrality (NFR9): an unknown/expired/already-consumed/wrong-share
 *     token PEEKS false and shows the SAME neutral expired state as a bare landing -
 *     no oracle. The interstitial carries NO report title or author identity.
 *
 * CSRF: the confirm POST is a same-origin SvelteKit form action, so the framework's
 * built-in origin check applies (never disabled). The whole route stays reader-realm,
 * noindex (the /r/* X-Robots-Tag header + the page <meta robots>), and no-store.
 */

type LoadResult = { state: 'confirm'; token: string } | { state: 'expired' };

export const load: PageServerLoad = async ({
	params,
	url,
	getClientAddress,
	setHeaders
}): Promise<LoadResult> => {
	// The landing may end in a reader session (via the confirm POST): never let an
	// intermediary cache it (NFR10). Set before any branch so every exit carries it.
	setHeaders({ 'cache-control': 'no-store' });

	const share = await getShareByToken(params.token);
	if (!share || share.status !== 'active') {
		serveNeutralClosed(setHeaders);
	}

	// Single mode (story 8.4): no magic-link verification - reads are consultation
	// tokens served at the load. A landing here (a stale MULTI-era link, or a forged
	// `?t=`) opens NO session; it bounces to the neutral expired state.
	if (!isMultiAuthor()) {
		redirect(303, `/r/${params.token}?expired=1`);
	}

	const rawVerification = url.searchParams.get('t') ?? '';

	// Same rate-limit envelope as the email submission. A throttled landing returns
	// the IDENTICAL expired state as a failed peek, never a distinct 429 page (NFR9).
	// Only a NON-EMPTY `?t=` is a genuine attempt charged against the per-share and
	// global brakes; an empty-token landing is bounded per-IP alone. The peek does NOT
	// consume, so a scanner prefetch costs only rate-limit budget, never the token.
	if (!withinVerificationLimit(getClientAddress(), share.id, rawVerification !== '')) {
		return { state: 'expired' };
	}

	if (rawVerification === '') {
		// A bare landing with no token is not an attempt: show the same expired state
		// without touching the peek or the shared brakes.
		return { state: 'expired' };
	}

	// Read-only validity peek for THIS share: render the confirm interstitial only for
	// a live token. A used/expired/wrong-share token shows the identical neutral
	// expired state, no leak.
	const live = await peekVerification(rawVerification, share.id);
	return live ? { state: 'confirm', token: rawVerification } : { state: 'expired' };
};

/**
 * Per-(IP, share) limit, then the IP-independent per-share brake (keyed by share
 * alone), then the IP-independent global brake (the reverse-proxy second line),
 * mirroring the email-submission action. The per-IP bucket is consumed on EVERY
 * landing (so a single IP probing is always bounded); the per-share and global
 * brakes are consumed ONLY when `tokenAttempt` is true (a non-empty `?t=`). An
 * empty-token probe is therefore bounded per-IP but cannot drain the shared brakes.
 */
function withinVerificationLimit(
	clientAddress: string,
	shareId: string,
	tokenAttempt: boolean
): boolean {
	const perIp = verificationRateLimiter.consume(`${clientAddress}:${shareId}`);
	if (!perIp.allowed) return false;
	if (!tokenAttempt) return true;
	const perShare = verificationShareLimiter.consume(shareId);
	if (!perShare.allowed) return false;
	const global = verificationFailureLimiter.consume(GLOBAL_VERIFICATION_KEY);
	return global.allowed;
}

export const actions: Actions = {
	confirm: async (event) => confirmVerificationAction(event)
};

/**
 * Confirm action: atomically consumes the single-use token for this share and opens
 * the reader session - the exact step the old GET handler ran, now behind a
 * same-origin POST so a scanner prefetch (a GET) can never trigger it. Single-use +
 * 15-min TTL + the share binding are enforced inside `completeVerification`'s atomic
 * consume, unchanged. A closed share is the same neutral 404 as the load; a
 * used/expired/wrong-share token (or a single mode landing) bounces to the neutral
 * "request a new link" state, identical for every cause (NFR9).
 */
async function confirmVerificationAction(event: RequestEvent) {
	const { params, request, cookies, setHeaders } = event;
	setHeaders({ 'cache-control': 'no-store' });

	const share = await getShareByToken(params.token);
	if (!share || share.status !== 'active') {
		serveNeutralClosed(setHeaders);
	}

	// Single mode: no verification path. A stray confirm POST opens no session.
	if (!isMultiAuthor()) {
		redirect(303, `/r/${params.token}?expired=1`);
	}

	const data = await request.formData();
	const field = data.get('t');
	const rawVerification = typeof field === 'string' ? field : '';
	if (rawVerification === '') {
		redirect(303, `/r/${params.token}?expired=1`);
	}

	const result = await completeVerification(rawVerification, share.id, share.reportId);
	if (!result) {
		// Used / expired / wrong-share: bounce to the gate's expired state. Identical
		// for every failure cause.
		redirect(303, `/r/${params.token}?expired=1`);
	}

	setReaderCookie(cookies, result.session.token, result.session.expiresAt);
	redirect(303, `/r/${params.token}`);
}
