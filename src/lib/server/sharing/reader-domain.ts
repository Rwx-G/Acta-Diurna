/**
 * Reader destination allow-list (Epic 8, story 8.5). An OPTIONAL operator gate
 * that complements the per-share recipient list: when `READER_EMAIL_DOMAINS` is
 * set (multi mode), a reader email may verify only if its domain matches one of
 * the configured patterns. Absent -> any verified email may read (subject to the
 * per-share recipient list), byte-identical to today's behavior.
 *
 * Like the recipient allow-list, this predicate sits BEHIND the reader gate's
 * neutral confirmation: a domain miss issues NO token and sends NO mail, but the
 * reader sees the same "check your email" as a hit, so the refusal never reveals
 * whether a domain is allowed (NFR9 enumeration-safety).
 *
 * Pattern semantics (matched case-insensitively on the normalized email domain,
 * which `READER_EMAIL_DOMAINS` is parsed to a trimmed/lowercased list at boot):
 *
 *   - Exact (`example.org`): matches that domain only. `a.example.org` does NOT
 *     match.
 *   - Leading-`*.` wildcard (`*.example.com`): matches any subdomain
 *     (`a.example.com`, `a.b.example.com`) AND the apex (`example.com`). An
 *     operator who allows a domain's subdomains means "everyone at that domain",
 *     so the apex is included rather than requiring it be listed twice.
 */
import { serverEnv } from '$lib/server/env';

/** The domain part of an email (everything after the last '@'), lowercased. */
function emailDomain(email: string): string {
	return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

/**
 * Whether `domain` matches a single configured pattern. Both are already
 * lowercased (the domain from `emailDomain`, the pattern from the env parse).
 */
function domainMatchesPattern(domain: string, pattern: string): boolean {
	if (pattern.startsWith('*.')) {
		const suffix = pattern.slice(2);
		return domain === suffix || domain.endsWith(`.${suffix}`);
	}
	return domain === pattern;
}

/**
 * True when `email` is allowed by the reader destination allow-list. When
 * `READER_EMAIL_DOMAINS` is UNSET the list is inert and every email passes (the
 * pre-8.5 behavior); when set, only an email whose domain matches a configured
 * pattern passes. The email must already be normalized by the caller boundary
 * (the gate normalizes at the `/r/[token]` action); `emailDomain` re-lowercases
 * the domain defensively.
 */
export function isReaderEmailDomainAllowed(normalizedEmail: string): boolean {
	const patterns = serverEnv().READER_EMAIL_DOMAINS;
	if (patterns === undefined) return true;

	const domain = emailDomain(normalizedEmail);
	return patterns.some((pattern) => domainMatchesPattern(domain, pattern));
}
