/**
 * Reader email normalization. A reader's email is the identity key (one global
 * `reader_identities` row per email) and part of the verification token binding,
 * so it must be canonicalized once, at the system boundary, BEFORE it is hashed,
 * stored, compared, or looked up - otherwise `Reader@Example.com ` and
 * `reader@example.com` would mint two identities and a forwarded link bound to
 * one casing would not match the other.
 *
 * Canonical form: trimmed and lowercased. We do NOT touch the local part beyond
 * case (no dot-stripping, no plus-tag removal): those are provider-specific and
 * collapsing them would let one address impersonate another reader's identity.
 */
export function normalizeEmail(raw: string): string {
	return raw.trim().toLowerCase();
}

// Pragmatic email shape check at the boundary: a local part, an @, and a dotted
// domain. Not RFC 5322-exhaustive (that rejects valid addresses and accepts
// absurd ones); the real proof of an address is that the magic link arrives.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True when the value is a plausibly-deliverable email shape. */
export function isPlausibleEmail(value: string): boolean {
	return value.length <= 254 && EMAIL_PATTERN.test(value);
}
