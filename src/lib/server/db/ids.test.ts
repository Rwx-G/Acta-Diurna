import { describe, expect, it } from 'vitest';
import { uuidv7 } from './ids';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv7', () => {
	it('produces RFC 9562 UUIDv7 strings (version 7, variant 10)', () => {
		expect(uuidv7()).toMatch(UUID_PATTERN);
	});

	it('encodes the unix-millisecond timestamp in the first 48 bits', () => {
		const now = 1_765_432_109_876;
		const id = uuidv7(now);

		expect(id.replaceAll('-', '').slice(0, 12)).toBe(now.toString(16).padStart(12, '0'));
	});

	it('sorts by generation time across different milliseconds', () => {
		const earlier = uuidv7(1_000_000_000_000);
		const later = uuidv7(1_000_000_000_001);

		expect(earlier < later).toBe(true);
	});

	it('does not repeat', () => {
		const ids = new Set(Array.from({ length: 1000 }, () => uuidv7()));

		expect(ids.size).toBe(1000);
	});
});
