import { beforeEach, describe, expect, it, vi } from 'vitest';

// Author magic-link landing behavior: single mode bounces to /login; a failed
// consume bounces to the expired state; a successful consume sets the author
// cookie and redirects to /reports. SvelteKit's redirect() throws, so the
// success/expired paths are asserted as thrown redirect objects.

const modeState = vi.hoisted(() => ({ multi: true }));
vi.mock('$lib/server/mode', () => ({
	operatingMode: () => (modeState.multi ? 'multi' : 'single'),
	isMultiAuthor: () => modeState.multi
}));

const mocks = vi.hoisted(() => ({
	completeAuthorSignIn: vi.fn(),
	setAuthorCookie: vi.fn(),
	perIpConsume: vi.fn(),
	globalConsume: vi.fn()
}));

vi.mock('$lib/server/auth/author-gate', () => ({
	completeAuthorSignIn: mocks.completeAuthorSignIn
}));
vi.mock('$lib/server/auth/cookies', () => ({ setAuthorCookie: mocks.setAuthorCookie }));
vi.mock('$lib/server/auth/rate-limit', () => ({
	GLOBAL_AUTHOR_VERIFICATION_KEY: 'global',
	authorVerificationRateLimiter: { consume: mocks.perIpConsume },
	authorVerificationFailureLimiter: { consume: mocks.globalConsume }
}));

import { GET } from './+server';

function event(search: string, overrides: Record<string, unknown> = {}) {
	return {
		url: new URL(`https://host/login/verify${search}`),
		cookies: {},
		getClientAddress: () => '203.0.113.6',
		setHeaders: vi.fn(),
		...overrides
	} as never;
}

beforeEach(() => {
	modeState.multi = true;
	for (const m of Object.values(mocks)) m.mockReset();
	mocks.perIpConsume.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
	mocks.globalConsume.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
});

describe('GET /login/verify', () => {
	it('mints the session on a valid consume and redirects to /reports', async () => {
		mocks.completeAuthorSignIn.mockResolvedValue({ token: 'sess', expiresAt: new Date() });

		await expect(GET(event('?t=good'))).rejects.toMatchObject({
			status: 303,
			location: '/reports'
		});
		expect(mocks.completeAuthorSignIn).toHaveBeenCalledWith('good');
		expect(mocks.setAuthorCookie).toHaveBeenCalledOnce();
	});

	it('bounces to the expired state when the token is used/expired/forged (single-use)', async () => {
		mocks.completeAuthorSignIn.mockResolvedValue(null);

		await expect(GET(event('?t=dead'))).rejects.toMatchObject({
			status: 303,
			location: '/login?expired=1'
		});
		expect(mocks.setAuthorCookie).not.toHaveBeenCalled();
	});

	it('bounces to the expired state on a bare landing with no token (no consume, no brake)', async () => {
		await expect(GET(event(''))).rejects.toMatchObject({
			status: 303,
			location: '/login?expired=1'
		});
		expect(mocks.completeAuthorSignIn).not.toHaveBeenCalled();
		// An empty-token probe is bounded per-IP only, never charged to the global brake.
		expect(mocks.globalConsume).not.toHaveBeenCalled();
	});

	it('single mode: bounces to /login and mints nothing (no magic-link path)', async () => {
		modeState.multi = false;

		await expect(GET(event('?t=whatever'))).rejects.toMatchObject({
			status: 303,
			location: '/login'
		});
		expect(mocks.completeAuthorSignIn).not.toHaveBeenCalled();
		expect(mocks.setAuthorCookie).not.toHaveBeenCalled();
	});

	it('a throttled landing returns the identical expired bounce (no 429 oracle)', async () => {
		mocks.perIpConsume.mockReturnValue({ allowed: false, retryAfterSeconds: 30 });

		await expect(GET(event('?t=good'))).rejects.toMatchObject({
			status: 303,
			location: '/login?expired=1'
		});
		expect(mocks.completeAuthorSignIn).not.toHaveBeenCalled();
	});
});
