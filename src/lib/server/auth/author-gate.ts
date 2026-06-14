/**
 * Author magic-link sign-in orchestration (Epic 8, story 8.3): the two
 * service-level steps the login route calls, keeping the route thin. The
 * author-realm parallel of the reader `gate.ts`.
 *
 *   - `requestAuthorSignIn`: issue a single-use token for an in-domain email and
 *     email the sign-in link. ALWAYS the same outcome to the caller regardless of
 *     whether the email is in the allowed author domain (enumeration-safety,
 *     NFR9) - an out-of-domain or unknown email issues NO token and sends NO mail
 *     but returns the SAME void result.
 *   - `completeAuthorSignIn`: consume the token (single-use, atomic), MINT the
 *     author row on first sign-in (self-service provisioning into the 8.2 authors
 *     table), and open an author-realm session bound to that author id so
 *     `resolveAuthorScope` returns the REAL logged-in author in multi mode.
 */
import { ensureAuthor } from '$lib/server/authors';
import {
	consumeAuthorVerificationToken,
	hasLiveAuthorVerification,
	issueAuthorVerificationToken,
	peekAuthorVerificationToken
} from './author-verification';
import { isAuthorEmailInDomain } from './author-domain';
import { createAuthorSession, type CreatedSession } from './sessions';
import { authorMagicLinkEmail } from '$lib/server/mail/templates/author-magic-link';
import { sendMail } from '$lib/server/mail/send';
import { logger } from '$lib/server/logger';

/**
 * Issues an author verification token for `normalizedEmail` and sends the sign-in
 * link - but ONLY for an email within `AUTHOR_EMAIL_DOMAIN`. `signInUrlFor`
 * composes the absolute landing URL from the raw token (the route owns ORIGIN +
 * the `/login/verify` shape).
 *
 * Enumeration-safety (NFR9), BEHIND the neutral return: `isAuthorEmailInDomain`
 * is the FIRST check. An out-of-domain (or otherwise unknown) email issues NO
 * token and sends NO mail, but returns the SAME void result as the in-domain path
 * - the caller's neutral confirmation is byte-identical either way, so the refusal
 * never reveals whether the email is an authorized author. No author is minted on
 * request (minting happens only on a verified consume), so a request never creates
 * a row an attacker could later detect.
 *
 * Dedup-before-issue (mail-amplification guard): if a LIVE (unconsumed, unexpired)
 * author verification already exists for this email, no new token is issued and no
 * second mail is sent, capping the email to one pending verification per 15-min
 * TTL. Like the domain refusal, the suppression is silent (same void result).
 *
 * Timing-equivalence (NFR9): the mail send is FIRE-AND-FORGET on the in-domain
 * path - the function returns WITHOUT awaiting `sendMail`, so the slow,
 * attacker-observable SMTP round-trip is never in the response timing on EITHER
 * path. The two paths are not strictly identical work (the off-domain path returns
 * after one in-process domain check; the in-domain path adds a dedup read and a
 * token insert), but the SMTP round-trip - the only network-scale separator - is
 * removed from both, leaving a sub-millisecond local-DB residual below the network
 * noise floor (the same stance reader gate.ts documents). The send error is logged
 * server-side (NFR16) inside the catch so a fire-and-forget rejection is never
 * unhandled and never leaks to the author.
 */
export async function requestAuthorSignIn(
	normalizedEmail: string,
	signInUrlFor: (rawToken: string) => string,
	requestId?: string
): Promise<void> {
	if (!isAuthorEmailInDomain(normalizedEmail)) return;
	if (await hasLiveAuthorVerification(normalizedEmail)) return;

	const { token } = await issueAuthorVerificationToken(normalizedEmail);
	const url = signInUrlFor(token);

	// Fire-and-forget: the response does not wait on SMTP (timing-equivalence),
	// and a delivery failure is logged here (NFR16) so the floating promise never
	// rejects unhandled. The author sees the neutral confirmation regardless.
	void sendMail(authorMagicLinkEmail(normalizedEmail, url), requestId).catch((error) => {
		logger.warn({ requestId, err: error }, 'author sign-in mail send failed');
	});
}

/**
 * Completes author sign-in: atomically consumes the single-use token, then (on
 * success) mints-or-finds the author row for the bound email (self-service
 * provisioning, idempotent via `ensureAuthor`) and opens an author-realm session
 * bound to that author id. Returns null when the token is invalid/used/expired -
 * the route maps that to the neutral "request a new link" state, never
 * distinguishing the cause.
 *
 * The session carries the author id (sessions.author_id), so once the cookie is
 * set the `authorRealm` hook resolves it into `locals.authorSession.authorId` and
 * `resolveAuthorScope` filters by the real author (tenancy, 8.2).
 */
/**
 * Read-only validity check for the magic-link interstitial (A1 mitigation): true
 * when the token EXISTS and is unconsumed/unexpired, WITHOUT consuming it. The GET
 * landing renders the "Confirm sign-in" interstitial only when this is true, so a
 * mail-gateway scanner that GET-prefetches the link never burns the token; the
 * human's confirm POST runs `completeAuthorSignIn` and consumes it for real. An
 * invalid/used/expired token returns false and the landing shows the same neutral
 * "request a new link" state - no oracle for which cause (NFR9).
 */
export async function peekAuthorSignIn(rawToken: string): Promise<boolean> {
	return peekAuthorVerificationToken(rawToken);
}

export async function completeAuthorSignIn(rawToken: string): Promise<CreatedSession | null> {
	const email = await consumeAuthorVerificationToken(rawToken);
	if (!email) return null;

	// First sign-in mints the author row (self-service); a returning author finds
	// the existing row. ensureAuthor is idempotent and concurrency-safe.
	const authorId = await ensureAuthor(email);
	return createAuthorSession(authorId);
}
