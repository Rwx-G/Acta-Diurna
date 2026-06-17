/**
 * Reversible at-rest encryption for share tokens (AES-256-GCM), so the owner can
 * re-display and re-send an existing share link. The reader gate still resolves a
 * presented token by its SHA-256 `token_hash` (unchanged); this cipher only shows
 * the link back to the authenticated owner in the management view.
 *
 * The key is derived from SESSION_SECRET via HKDF-SHA256 with a domain-separation
 * label, so it is distinct from session signing and is never the raw secret. A
 * DB-only leak (without SESSION_SECRET) therefore yields no usable links. Rotating
 * SESSION_SECRET makes existing ciphers undecryptable (the link becomes
 * unrecoverable, surfaced in the UI as "revoke and recreate"); the GCM auth tag
 * makes a tampered or wrong-key value fail closed rather than return garbage.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { serverEnv } from '$lib/server/env';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const KEY_INFO = 'acta:share-token-cipher:v1';

function deriveKey(): Buffer {
	const secret = serverEnv().SESSION_SECRET;
	return Buffer.from(hkdfSync('sha256', secret, new Uint8Array(0), KEY_INFO, KEY_BYTES));
}

/** Encrypts a raw share token to a base64 `iv || tag || ciphertext` envelope. */
export function encryptShareToken(rawToken: string): string {
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALGORITHM, deriveKey(), iv);
	const ciphertext = Buffer.concat([cipher.update(rawToken, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/**
 * Decrypts an envelope back to the raw token, or returns null when the value is
 * absent or cannot be authenticated (tampered, or encrypted under a now-rotated
 * SESSION_SECRET). Never throws: an unrecoverable link is a UI state, not a 500.
 */
export function decryptShareToken(envelope: string | null): string | null {
	if (!envelope) return null;
	try {
		const bytes = Buffer.from(envelope, 'base64');
		const iv = bytes.subarray(0, IV_BYTES);
		const tag = bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
		const ciphertext = bytes.subarray(IV_BYTES + TAG_BYTES);
		const decipher = createDecipheriv(ALGORITHM, deriveKey(), iv);
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
	} catch {
		return null;
	}
}
