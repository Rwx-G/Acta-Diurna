import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setReaderCookie } from '$lib/server/auth/cookies';
import {
	GLOBAL_VERIFICATION_KEY,
	verificationFailureLimiter,
	verificationRateLimiter
} from '$lib/server/auth/rate-limit';
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
	const share = await getShareByToken(params.token);
	if (!share || share.status !== 'active') {
		serveNeutralClosed(setHeaders);
	}

	// Same rate-limit envelope as the email submission: a flood of magic-link
	// guesses (forged `?t=` values) engages the limiter.
	verificationRateLimiter.consume(`${getClientAddress()}:${share.id}`);
	verificationFailureLimiter.consume(GLOBAL_VERIFICATION_KEY);

	const rawVerification = url.searchParams.get('t') ?? '';
	const result = await completeVerification(rawVerification, share.id, share.reportId);

	if (!result) {
		// Used / expired / wrong-share: bounce to the gate's expired state (UX Flow
		// C "request a new link"). Identical for every failure cause.
		redirect(303, `/r/${params.token}?expired=1`);
	}

	setReaderCookie(cookies, result.session.token, result.session.expiresAt);
	redirect(303, `/r/${params.token}`);
};
