import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashToken } from './hash-token';

describe('hashToken', () => {
	it('returns the SHA-256 hex digest of the token', () => {
		const expected = createHash('sha256').update('some-token').digest('hex');
		expect(hashToken('some-token')).toBe(expected);
	});

	it('never returns the raw token (hash-at-rest contract)', () => {
		expect(hashToken('raw')).not.toContain('raw');
	});

	it('is deterministic and 64 hex chars', () => {
		const a = hashToken('x');
		const b = hashToken('x');
		expect(a).toBe(b);
		expect(a).toMatch(/^[0-9a-f]{64}$/);
	});

	it('distinguishes different tokens', () => {
		expect(hashToken('a')).not.toBe(hashToken('b'));
	});
});
