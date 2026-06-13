import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setReaderCookie } from '$lib/server/auth/cookies';
import {
	GLOBAL_VERIFICATION_KEY,
	verificationFailureLimiter,
	verificationRateLimiter,
	verificationShareLimiter
} from '$lib/server/auth/rate-limit';
import { isMultiAuthor } from '$lib/server/mode';
import { completeVerification, serveNeutralClosed } from '$lib/server/reader';
import { getShareByToken } from '$lib/server/sharing';

/**
 * Magic-link landing (story 3.3). The reader arrives here from the emailed link
 * with the single-use verification token in `?t=`. Flow:
 *
 *   - Resolve the share by the URL `[token]`. A closed/unknown share is the same
 *     neutral 404 as everywhere else (NFR9).
 *   - Atomically consume the verification token for THIS share (single-use): a
 *     second click, an expired token, or a token bound to another share all fail
 *     identically and redirect to the neutral "request a new link" state - never
 *     distinguishing the cause.
 *   - On success: a per-share reader session is opened (identity recorded +
 *     access audited inside `completeVerification`), the `acta_reader` cookie is
 *     set, and the reader is redirected to the report (FR22).
 *
 * GET is correct here: the link is clicked from an email client (a navigation),
 * and the consume is idempotent-safe (single-use is enforced by the atomic
 * UPDATE, so a prefetch that burns the token only costs that reader a re-request,
 * it cannot be replayed).
 */
export const GET: RequestHandler = async ({
	params,
	url,
	cookies,
	getClientAddress,
	setHeaders
}) => {
	// The magic-link landing is a sensitive response: it consumes a single-use
	// token and may open a reader session. Never let an intermediary cache it
	// (NFR10), so a revoked link's previously-served verify step cannot be replayed
	// from a cache. Set before any branch so every exit (neutral 404, expired
	// bounce, success redirect) carries it.
	setHeaders({ 'cache-control': 'no-store' });

	const share = await getShareByToken(params.token);
	if (!share || share.status !== 'active') {
		serveNeutralClosed(setHeaders);
	}

	// Single mode (story 8.4): there is no magic-link verification - reads are
	// consultation tokens served at the load. A landing here (a stale MULTI-era
	// link clicked after SMTP was removed, or a forged `?t=`) opens NO session; it
	// bounces to the neutral expired state, identical to a dead token, so the mode
	// change never lets a verification link grant access it no longer should.
	if (!isMultiAuthor()) {
		redirect(303, `/r/${params.token}?expired=1`);
	}

	const rawVerification = url.searchParams.get('t') ?? '';

	// Same rate-limit envelope as the email submission: a flood of magic-link
	// guesses (forged `?t=` values) engages the limiter. When a bucket denies,
	// short-circuit BEFORE consuming the token so the throttle takes effect (the
	// buckets are not bookkeeping-only). A throttled landing returns the IDENTICAL
	// expired bounce as a failed consume, never a distinct 429 page, so no new
	// enumeration oracle is introduced (NFR9).
	//
	// Only a NON-EMPTY `?t=` is a genuine token-consume attempt, and only such an
	// attempt is charged against the shared per-share and global brakes. A
	// share-link holder spamming empty-token landing GETs is bounded by the per-IP
	// bucket ALONE, so it cannot drain the per-share/global brakes and lock out
	// new-reader verification on that share.
	if (!withinVerificationLimit(getClientAddress(), share.id, rawVerification !== '')) {
		redirect(303, `/r/${params.token}?expired=1`);
	}

	if (rawVerification === '') {
		// A magic-link landing with no token (the bare share-link GET) is not a
		// consume attempt: bounce to the same expired state a failed consume returns,
		// without touching `completeVerification` or the shared brakes.
		redirect(303, `/r/${params.token}?expired=1`);
	}

	const result = await completeVerification(rawVerification, share.id, share.reportId);

	if (!result) {
		// Used / expired / wrong-share: bounce to the gate's expired state (UX Flow
		// C "request a new link"). Identical for every failure cause.
		redirect(303, `/r/${params.token}?expired=1`);
	}

	setReaderCookie(cookies, result.session.token, result.session.expiresAt);
	redirect(303, `/r/${params.token}`);
};

/**
 * Per-(IP, share) limit, then the IP-independent per-share brake (keyed by share
 * alone), then the IP-independent global brake (the reverse-proxy second line),
 * mirroring the email-submission action. The per-IP bucket is consumed on EVERY
 * landing (so a single IP probing is always bounded); the per-share and global
 * brakes are consumed ONLY when `tokenAttempt` is true (a non-empty `?t=`). An
 * empty-token probe is therefore bounded per-IP but cannot drain the shared
 * brakes - one share-link holder cannot starve new-reader verification on the
 * share or, via the global brake, on every other share.
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
