import { describe, expect, it, vi } from 'vitest';
import { decryptShareToken, encryptShareToken } from './token-cipher';

// The cipher reads SESSION_SECRET lazily on every encrypt/decrypt (via
// deriveKey), so mutating this hoisted object mid-test simulates a SESSION_SECRET
// rotation and lets us assert a stale envelope no longer decrypts.
const env = vi.hoisted(() => ({ SESSION_SECRET: 's'.repeat(32) }));

vi.mock('$lib/server/env', () => ({
	serverEnv: () => env
}));

describe('share token cipher', () => {
	it('round-trips an encrypted token back to the original', () => {
		const token = 'abc123-def456_GHIJKL';
		expect(decryptShareToken(encryptShareToken(token))).toBe(token);
	});

	it('returns null for a null or empty envelope', () => {
		expect(decryptShareToken(null)).toBeNull();
		expect(decryptShareToken('')).toBeNull();
	});

	it('returns null when the envelope is tampered (flipped byte fails the auth tag)', () => {
		const envelope = encryptShareToken('a-token-to-tamper');
		const bytes = Buffer.from(envelope, 'base64');
		// Flip a bit in the ciphertext tail; the GCM tag must reject it.
		bytes[bytes.length - 1] ^= 0x01;
		expect(decryptShareToken(bytes.toString('base64'))).toBeNull();
	});

	it('produces a different envelope each time (random IV)', () => {
		const token = 'same-token-twice';
		expect(encryptShareToken(token)).not.toBe(encryptShareToken(token));
	});

	it('returns null when decrypting under a rotated SESSION_SECRET', () => {
		const envelope = encryptShareToken('token-before-rotation');
		env.SESSION_SECRET = 'r'.repeat(32);
		try {
			expect(decryptShareToken(envelope)).toBeNull();
		} finally {
			env.SESSION_SECRET = 's'.repeat(32);
		}
	});
});
