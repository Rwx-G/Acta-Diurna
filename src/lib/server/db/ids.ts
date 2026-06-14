import { randomBytes } from 'node:crypto';

/**
 * Canonical UUID shape (8-4-4-4-12 lowercase hex), the single source of truth for
 * the boundary id guard every service applies: a malformed id is rejected as a 404
 * (or a no-match) BEFORE it reaches a postgres uuid cast, so a bad id is never a
 * 500 nor an existence oracle. Deliberately version-agnostic (not the v7-strict
 * shape `uuidv7` mints) so it also accepts ids minted elsewhere; the database
 * column is the real type gate.
 */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Generates a UUIDv7 (RFC 9562): 48-bit unix-millisecond timestamp followed
 * by random bits, so ids sort by creation time. Architecture rule: every
 * entity primary key is UUIDv7 (crypto.randomUUID() only produces v4).
 */
export function uuidv7(now: number = Date.now()): string {
	const bytes = randomBytes(16);

	// Division, not bit shifts: JS bitwise operators truncate to 32 bits and would drop the high bytes of the 48-bit timestamp.
	bytes[0] = Math.floor(now / 2 ** 40) % 256;
	bytes[1] = Math.floor(now / 2 ** 32) % 256;
	bytes[2] = Math.floor(now / 2 ** 24) % 256;
	bytes[3] = Math.floor(now / 2 ** 16) % 256;
	bytes[4] = Math.floor(now / 2 ** 8) % 256;
	bytes[5] = now % 256;

	bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
	bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx

	const hex = bytes.toString('hex');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
