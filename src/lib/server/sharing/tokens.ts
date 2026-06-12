import { createHash, randomBytes } from 'node:crypto';

/**
 * Share-link tokens (NFR6). The byte count is the entropy contract: 32 bytes =
 * 256 bits of randomness, well above the >= 128-bit floor NFR6 requires (and
 * matching the 1.4 author-session token strength). A share token is a bearer
 * credential resolved on every reader request, so it is hashed at rest exactly
 * like a session token: the raw token reaches the caller once (it goes only into
 * the share URL), only its SHA-256 hash is stored, and lookups hash the incoming
 * token and match on the hash. A database leak therefore exposes no usable link.
 */
export const SHARE_TOKEN_BYTES = 32;

/**
 * Generates a fresh share token: {@link SHARE_TOKEN_BYTES} random bytes, base64url
 * encoded so it is URL-safe in `/r/[token]`. The return is the RAW token; the
 * caller stores only {@link hashShareToken} of it.
 */
export function generateShareToken(): string {
	return randomBytes(SHARE_TOKEN_BYTES).toString('base64url');
}

/**
 * SHA-256 hash of a raw share token, hex-encoded. The same one-way function the
 * 1.4 session model uses for at-rest token storage: a leaked `token_hash` cannot
 * be reversed into a working share URL.
 */
export function hashShareToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}
