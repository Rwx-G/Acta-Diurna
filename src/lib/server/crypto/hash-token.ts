import { createHash } from 'node:crypto';

/**
 * One-way hash-at-rest for bearer tokens (D5). The raw token is a credential
 * (session cookie value, share-link token, reader verification token) handed to
 * the client once; only this SHA-256 hex digest is stored, and lookups hash the
 * incoming token and match on the digest. A database leak therefore exposes no
 * usable token.
 *
 * Single shared definition (rule of three): the author session store, the share
 * token service, the reader verification-token store, and the reader session
 * store all import this so the at-rest hash function never forks. Changing the
 * algorithm here changes it everywhere, by construction.
 */
export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}
