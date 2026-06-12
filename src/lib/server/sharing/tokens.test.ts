import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SHARE_TOKEN_BYTES, generateShareToken, hashShareToken } from './tokens';

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

describe('share token entropy', () => {
	it('mints at least 128 bits of entropy (32 bytes = 256 bits)', () => {
		expect(SHARE_TOKEN_BYTES).toBeGreaterThanOrEqual(16);
		// 32 base64url chars carry 24 raw bytes; 32 raw bytes encode to 43 chars.
		const raw = Buffer.from(generateShareToken(), 'base64url');
		expect(raw.length).toBe(SHARE_TOKEN_BYTES);
		expect(raw.length * 8).toBeGreaterThanOrEqual(128);
	});

	it('encodes URL-safe base64url with no padding (fits /r/[token])', () => {
		const token = generateShareToken();
		expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(token).not.toContain('=');
		expect(token).not.toContain('+');
		expect(token).not.toContain('/');
	});

	it('mints a fresh token each call', () => {
		const tokens = new Set(Array.from({ length: 50 }, () => generateShareToken()));
		expect(tokens.size).toBe(50);
	});
});

describe('hashShareToken', () => {
	it('is the SHA-256 hex of the token (the 1.4 session hash-at-rest function)', () => {
		const token = generateShareToken();
		expect(hashShareToken(token)).toBe(sha256(token));
	});

	it('never returns the raw token (one-way at rest)', () => {
		const token = generateShareToken();
		const hash = hashShareToken(token);
		expect(hash).not.toBe(token);
		expect(hash).not.toContain(token);
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
	});

	it('is deterministic for the same token and distinct for different tokens', () => {
		const a = generateShareToken();
		const b = generateShareToken();
		expect(hashShareToken(a)).toBe(hashShareToken(a));
		expect(hashShareToken(a)).not.toBe(hashShareToken(b));
	});
});
