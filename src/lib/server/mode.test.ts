import { beforeEach, describe, expect, it, vi } from 'vitest';

const serverEnv = vi.fn();
vi.mock('$lib/server/env', () => ({ serverEnv }));

let mode: typeof import('./mode');

beforeEach(async () => {
	vi.clearAllMocks();
	mode = await import('./mode');
});

describe('operatingMode', () => {
	it('resolves to single when SMTP is absent', () => {
		serverEnv.mockReturnValue({});

		expect(mode.operatingMode()).toBe('single');
		expect(mode.isMultiAuthor()).toBe(false);
	});

	it('resolves to multi when SMTP is configured', () => {
		serverEnv.mockReturnValue({ SMTP_HOST: 'smtp.example.com' });

		expect(mode.operatingMode()).toBe('multi');
		expect(mode.isMultiAuthor()).toBe(true);
	});

	it('reads the cached env on each call (no separate mode state)', () => {
		serverEnv.mockReturnValue({});
		expect(mode.operatingMode()).toBe('single');

		serverEnv.mockReturnValue({ SMTP_HOST: 'smtp.example.com' });
		expect(mode.operatingMode()).toBe('multi');
	});
});
