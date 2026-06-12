/**
 * Reader verification orchestration (story 3.3): the two service-level steps the
 * `/r/[token]` routes call, keeping the route files thin.
 *
 *   - `requestVerification`: issue a single-use token for (share, email) and
 *     email the magic link. ALWAYS the same outcome to the caller regardless of
 *     whether the email is "authorized" (enumeration-safety, NFR9): in
 *     open-by-default mode (3.3) every email gets a link; 3.4 adds the
 *     restricted-list check HERE behind the same neutral return so the response
 *     never reveals list membership.
 *   - `completeVerification`: consume the token, find-or-create the identity,
 *     write the access-audit row, and open a per-share reader session.
 */
import {
	consumeVerificationToken,
	hasLiveVerification,
	issueVerificationToken
} from './verification';
import { findOrCreateIdentity, recordAccess } from './identities';
import { magicLinkEmail } from '$lib/server/mail/templates/magic-link';
import { sendMail } from '$lib/server/mail/send';
import { isAuthorizedReader } from '$lib/server/sharing';
import type { ResolvedShare } from '$lib/server/sharing';
import { logger } from '$lib/server/logger';
import { createReaderSession, type CreatedSession } from '$lib/server/auth/sessions';

/**
 * Issues a verification token for (share, normalizedEmail) and sends the magic
 * link - but ONLY to an authorized email. `verifyUrlFor` composes the absolute
 * landing URL from the raw token (the route owns ORIGIN + the `/r/[token]/verify`
 * shape).
 *
 * Restricted-mode allow-list check (FR19, story 3.4), BEHIND the neutral return:
 * `isAuthorizedReader(share, email)` is the FIRST step. In `open` mode it is true
 * for any email (no DB read); in `restricted` mode it is true only for an email
 * on the share's recipient list. An UNAUTHORIZED (off-list) email issues NO
 * token and sends NO mail, but returns the SAME void result as the authorized
 * path - the caller's neutral `{state:'sent'}` is byte-identical either way, so
 * the refusal never reveals whether the email was known (NFR9).
 *
 * Dedup-before-issue (mail-amplification guard): if a LIVE (unconsumed,
 * unexpired) verification already exists for this (share, email), no new token
 * is issued and no second mail is sent, capping the pair to one pending
 * verification per 15-min TTL. Like the allow-list refusal, the suppression is
 * silent (same void result).
 *
 * Timing-equivalence (NFR9): the mail send is FIRE-AND-FORGET on the authorized
 * path - the function returns WITHOUT awaiting `sendMail`, so the slow,
 * attacker-observable SMTP round-trip is never in the response timing on EITHER
 * path. The two paths are NOT strictly identical work: the off-list path returns
 * after one allow-list read, while the on-list path adds a dedup read and a token
 * insert. They are indistinguishable in practice over the network - the SMTP
 * round-trip (the only network-scale separator) is removed from both paths, and
 * the residual is sub-millisecond local DB work below the network noise floor,
 * the same residual band NFR9 accepts from 3.3's dedup-suppressed-vs-sent split.
 * Removing the SMTP latency (the one large, variable cost that would have made
 * the two paths separable) is what closes the timing oracle; the local-DB delta
 * is not, on its own, an observable separator. A dummy-write constant-time
 * mitigation is not required for V1. The send error is logged server-side (NFR16)
 * inside the catch so a fire-and-forget rejection is never unhandled and never
 * leaks to the reader.
 */
export async function requestVerification(
	share: ResolvedShare,
	normalizedEmail: string,
	verifyUrlFor: (rawToken: string) => string,
	requestId?: string
): Promise<void> {
	if (!(await isAuthorizedReader(share, normalizedEmail))) return;
	if (await hasLiveVerification(share.id, normalizedEmail)) return;

	const { token } = await issueVerificationToken(share.id, normalizedEmail);
	const url = verifyUrlFor(token);

	// Fire-and-forget: the response does not wait on SMTP (timing-equivalence),
	// and a delivery failure is logged here (NFR16) so the floating promise never
	// rejects unhandled. The reader sees the neutral confirmation regardless.
	void sendMail(magicLinkEmail(normalizedEmail, url), requestId).catch((error) => {
		logger.warn({ requestId, err: error }, 'reader verification mail send failed');
	});
}

export interface CompletedVerification {
	session: CreatedSession;
	reportId: string;
}

/**
 * Completes verification: atomically consumes the single-use token for this
 * share, then (on success) records the verified identity + access and opens a
 * per-share reader session bound to (share, report, identity). Returns null when
 * the token is invalid/used/expired/wrong-share - the route maps that to the
 * neutral "request a new link" state, never distinguishing the cause.
 *
 * `reportId` is the share's report (the route already resolved the share), used
 * to bind the session and the audit row and to redirect the reader.
 */
export async function completeVerification(
	rawToken: string,
	shareId: string,
	reportId: string
): Promise<CompletedVerification | null> {
	const consumed = await consumeVerificationToken(rawToken, shareId);
	if (!consumed) return null;

	const identityId = await findOrCreateIdentity(consumed.email);
	await recordAccess(identityId, shareId, reportId);
	const session = await createReaderSession({
		shareId,
		reportId,
		readerIdentityId: identityId
	});

	return { session, reportId };
}
