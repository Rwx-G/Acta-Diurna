/**
 * Author email-domain check (Epic 8, story 8.3). Self-service author sign-up in
 * multi mode is restricted to emails within `AUTHOR_EMAIL_DOMAIN` (a bare domain,
 * e.g. `example.com`, validated at boot). This is the gate behind the
 * enumeration-safe neutral return: an out-of-domain email gets the SAME "check
 * your email" response as an in-domain one (NFR9), it simply never mints a token.
 *
 * The check is a case-insensitive exact match on the email's domain part. The
 * email must already be normalized (lowercased/trimmed) by the caller boundary,
 * the same normalization the reader path applies; this re-lowercases defensively.
 */
import { serverEnv } from '$lib/server/env';

/** The domain part of an email (everything after the last '@'), lowercased. */
function emailDomain(email: string): string {
	return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

/**
 * True when `email` is within the configured `AUTHOR_EMAIL_DOMAIN`. In single
 * mode `AUTHOR_EMAIL_DOMAIN` is unset (the env refine only requires it in multi
 * mode), so this returns false - the author magic-link path never runs in single
 * mode anyway (the gate is mode-guarded), this is defense in depth.
 */
export function isAuthorEmailInDomain(email: string): boolean {
	const domain = serverEnv().AUTHOR_EMAIL_DOMAIN;
	if (domain === undefined) return false;
	return emailDomain(email) === domain.toLowerCase();
}
