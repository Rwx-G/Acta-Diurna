import { describe, expect, it } from 'vitest';
import { isPlausibleEmail, normalizeEmail } from './email';

describe('normalizeEmail', () => {
	it('lowercases and trims', () => {
		expect(normalizeEmail('  Reader@Example.COM ')).toBe('reader@example.com');
	});

	it('is idempotent', () => {
		const once = normalizeEmail(' A@B.com ');
		expect(normalizeEmail(once)).toBe(once);
	});

	it('does not strip plus tags or dots (no impersonation collapse)', () => {
		expect(normalizeEmail('a.b+tag@example.com')).toBe('a.b+tag@example.com');
	});
});

describe('isPlausibleEmail', () => {
	it('accepts a plausible address', () => {
		expect(isPlausibleEmail('reader@example.com')).toBe(true);
	});

	it('rejects shapes without an @, domain dot, or with spaces', () => {
		expect(isPlausibleEmail('reader')).toBe(false);
		expect(isPlausibleEmail('reader@localhost')).toBe(false);
		expect(isPlausibleEmail('a b@example.com')).toBe(false);
		expect(isPlausibleEmail('')).toBe(false);
	});

	it('rejects an over-long address', () => {
		expect(isPlausibleEmail(`${'a'.repeat(250)}@example.com`)).toBe(false);
	});
});
