import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { readReaderCookie } from '$lib/server/auth/cookies';
import {
	GLOBAL_VERIFICATION_KEY,
	verificationFailureLimiter,
	verificationRateLimiter
} from '$lib/server/auth/rate-limit';
import { validateReaderSession } from '$lib/server/auth/sessions';
import { getPublishedDocument } from '$lib/server/documents/reports';
import { AppError } from '$lib/server/problem';
import {
	isPlausibleEmail,
	normalizeEmail,
	requestVerification,
	serveNeutralClosed
} from '$lib/server/reader';
import { getShareByToken } from '$lib/server/sharing';
import type { DocumentV1, ValidationErrorDetail } from '$lib/schema';

/**
 * Reader verification gate (story 3.3) in front of the `/r/[token]` render
 * route. The flow (UX Flow C):
 *
 *   - Resolve the share by its token (3.2 `getShareByToken`). A closed share
 *     (revoked/expired) or an unknown token serves ONE neutral 404 - byte-for-
 *     byte identical, no leak of which (NFR9/FR20, the 3.5 seam).
 *   - Active + a valid reader session FOR THIS SHARE -> serve the published
 *     snapshot directly, no re-verification (FR23).
 *   - Active + no session -> render the email-prompt VerifyCard; the
 *     `request-verification` action mails a single-use magic link and ALWAYS
 *     returns the same neutral confirmation (NFR9).
 *
 * The reader session is validated HERE, not in a hook, because it is per-share:
 * the share id from this URL is part of the validation, so a session for another
 * share never authorizes this one.
 */

type LoadResult =
	| { state: 'verified'; document: DocumentV1; renderError: null }
	| { state: 'verified'; document: null; renderError: ValidationErrorDetail[] }
	| { state: 'prompt' | 'expired' };

export const load: PageServerLoad = async ({
	params,
	url,
	cookies,
	setHeaders
}): Promise<LoadResult> => {
	const share = await getShareByToken(params.token);
	if (!share || share.status !== 'active') serveNeutralClosed(setHeaders);

	// FR23: a returning reader with a live session bound to THIS share skips
	// verification entirely.
	const readerToken = readReaderCookie(cookies);
	if (readerToken) {
		const session = await validateReaderSession(readerToken, share.id);
		if (session) return serveReport(share.reportId, setHeaders);
	}

	// No session: prompt for email. The reader page is noindexed by the security
	// header on /r/*; also keep it uncached so a closed share never serves a
	// stale verified view from an intermediary. `?expired=1` (the magic-link
	// landing's bounce for a used/expired link) shows the "request a new link"
	// state instead of the first-visit prompt.
	setHeaders({ 'cache-control': 'no-store' });
	const expired = url.searchParams.get('expired') === '1';
	return { state: expired ? 'expired' : 'prompt' };
};

/** The problem type `notShareable()` produces (reports.ts) when a report has no
 * live published snapshot. */
const NOT_PUBLISHED_PROBLEM_TYPE = '/problems/report-not-published';

async function serveReport(
	reportId: string,
	setHeaders: (headers: Record<string, string>) => void
): Promise<LoadResult> {
	setHeaders({ 'cache-control': 'no-store' });
	try {
		const document = await getPublishedDocument(reportId);
		return { state: 'verified', document, renderError: null };
	} catch (thrown) {
		if (thrown instanceof AppError) {
			// A published snapshot that fails version dispatch is the same neutral
			// render-error state the author view shows (FR7), never a crash.
			if (thrown.errors) {
				return { state: 'verified', document: null, renderError: thrown.errors };
			}
			// The share is live but its report was unpublished (or its snapshot
			// cleared) AFTER the share was created: `getPublishedDocument` throws a
			// 409 not-shareable. Surfacing that 409 would be an enumeration oracle
			// (a real share whose report just went away, distinguishable from the
			// byte-identical neutral 404 a revoked/expired/unknown share serves).
			// Route it through the same neutral closed-share exit instead (NFR9).
			if (thrown.type === NOT_PUBLISHED_PROBLEM_TYPE) {
				serveNeutralClosed(setHeaders);
			}
		}
		// Only a genuine, unexpected 5xx escapes to the SvelteKit error page.
		throw thrown;
	}
}

export const actions: Actions = {
	'request-verification': async (event) => requestVerificationAction(event)
};

/**
 * Email-submission action. Rate-limited per (IP, share) plus the global brake.
 * The response is IDENTICAL whether the email is known, unknown, or (in 3.4)
 * unauthorized - the only failure surfaced is a malformed email shape (a
 * client-side input error, not an authorization signal). A mail-delivery failure
 * is NOT surfaced to the reader (it would reveal an attempt was actually made for
 * a real recipient); it is logged by `sendMail` and swallowed at this boundary so
 * the reader always sees the same neutral confirmation.
 */
async function requestVerificationAction(event: RequestEvent) {
	const { params, request, locals, url, getClientAddress } = event;

	const share = await getShareByToken(params.token);
	if (!share || share.status !== 'active') {
		// A closed share gets the same neutral 404 as the load - never a hint that
		// the token once existed.
		serveNeutralClosed(event.setHeaders);
	}

	if (!withinVerificationLimit(getClientAddress(), share.id)) {
		// A throttled reader gets a generic retry signal, not an enumeration hint.
		return fail(429, { state: 'throttled' as const });
	}

	const data = await request.formData();
	const field = data.get('email');
	const email = typeof field === 'string' ? normalizeEmail(field) : '';
	if (!isPlausibleEmail(email)) {
		// A shape error is a form-validation problem, not an enumeration signal:
		// it tells the reader to fix their own typo, not whether they are allowed.
		return fail(400, { state: 'invalid' as const });
	}

	const verifyUrlFor = (rawToken: string): string =>
		`${url.origin}/r/${params.token}/verify?t=${rawToken}`;

	// 3.4: the restricted-list check lives INSIDE requestVerification, BEHIND this
	// same neutral return - an unauthorized (off-list) email silently gets no link,
	// but the reader sees the identical confirmation (NFR9). The mail send is
	// fire-and-forget inside requestVerification, so neither the on-list nor the
	// off-list path waits on SMTP and the response timing cannot separate them; any
	// pre-send error (DB) is swallowed here so the reader always sees the same
	// "check your email".
	try {
		await requestVerification(share, email, verifyUrlFor, locals.requestId);
	} catch {
		// A pre-send failure is never surfaced - surfacing it would reveal that work
		// was attempted for this address. The reader always sees the neutral state.
	}

	return { state: 'sent' as const };
}

/**
 * Per-(IP, share) limit plus the IP-independent global brake (the reverse-proxy
 * second line). Both are consumed on every attempt; either tripping throttles
 * the reader. Keyed by share so probing one share does not starve verification
 * on another.
 */
function withinVerificationLimit(clientAddress: string, shareId: string): boolean {
	const perIp = verificationRateLimiter.consume(`${clientAddress}:${shareId}`);
	if (!perIp.allowed) return false;
	const global = verificationFailureLimiter.consume(GLOBAL_VERIFICATION_KEY);
	return global.allowed;
}
