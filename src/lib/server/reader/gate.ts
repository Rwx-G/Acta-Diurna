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
import { createReaderSession, type CreatedSession } from '$lib/server/auth/sessions';

/**
 * Issues a verification token for (shareId, normalizedEmail) and sends the magic
 * link. `verifyUrlFor` composes the absolute landing URL from the raw token
 * (the route owns ORIGIN + the `/r/[token]/verify` shape). A mail failure
 * propagates as the `sendMail` AppError so the operator is not left thinking a
 * link was delivered (NFR16); the caller decides how to surface it WITHOUT
 * leaking whether the email was on any list.
 *
 * Dedup-before-issue (mail-amplification guard): if a LIVE (unconsumed,
 * unexpired) verification already exists for this (share, email), no new token
 * is issued and no second mail is sent. This caps the pair to one pending
 * verification per 15-min TTL, blunting amplification by an attacker who holds
 * one open-mode share link and POSTs arbitrary victim emails. The suppression is
 * silent: the function still returns void exactly as on a real send, so the
 * caller's neutral `{state:'sent'}` is identical whether mail was sent or
 * suppressed (enumeration-safety, the dedup is never revealed).
 */
export async function requestVerification(
	shareId: string,
	normalizedEmail: string,
	verifyUrlFor: (rawToken: string) => string,
	requestId?: string
): Promise<void> {
	if (await hasLiveVerification(shareId, normalizedEmail)) return;
	const { token } = await issueVerificationToken(shareId, normalizedEmail);
	const url = verifyUrlFor(token);
	await sendMail(magicLinkEmail(normalizedEmail, url), requestId);
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
