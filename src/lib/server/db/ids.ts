import { randomBytes } from 'node:crypto';

/**
 * Generates a UUIDv7 (RFC 9562): 48-bit unix-millisecond timestamp followed
 * by random bits, so ids sort by creation time. Architecture rule: every
 * entity primary key is UUIDv7 (crypto.randomUUID() only produces v4).
 */
export function uuidv7(now: number = Date.now()): string {
	const bytes = randomBytes(16);

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
