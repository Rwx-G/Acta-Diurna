import { beforeEach, describe, expect, it, vi } from 'vitest';

// Author magic-link landing behavior (A1 prefetch-safe interstitial): the GET `load`
// PEEKS without consuming - single mode bounces to /login, a live token renders the
// confirm interstitial, a dead/empty/throttled token shows the neutral expired state,
// and NO consume happens on the GET. The `confirm` action consumes: a valid token
// mints the author cookie and redirects to /reports, a dead token bounces to expired.
// SvelteKit's redirect() throws, so redirect paths are asserted as thrown objects.

const modeState = vi.hoisted(() => ({ multi: true }));
vi.mock('$lib/server/mode', () => ({
	operatingMode: () => (modeState.multi ? 'multi' : 'single'),
	isMultiAuthor: () => modeState.multi
}));

const mocks = vi.hoisted(() => ({
	peekAuthorSignIn: vi.fn(),
	completeAuthorSignIn: vi.fn(),
	setAuthorCookie: vi.fn(),
	perIpConsume: vi.fn(),
	globalConsume: vi.fn()
}));

vi.mock('$lib/server/auth/author-gate', () => ({
	peekAuthorSignIn: mocks.peekAuthorSignIn,
	completeAuthorSignIn: mocks.completeAuthorSignIn
}));
vi.mock('$lib/server/auth/cookies', () => ({ setAuthorCookie: mocks.setAuthorCookie }));
vi.mock('$lib/server/auth/rate-limit', () => ({
	GLOBAL_AUTHOR_VERIFICATION_KEY: 'global',
	authorVerificationRateLimiter: { consume: mocks.perIpConsume },
	authorVerificationFailureLimiter: { consume: mocks.globalConsume }
}));

import { load, actions } from './+page.server';

function loadEvent(search: string, overrides: Record<string, unknown> = {}) {
	return {
		url: new URL(`https://host/login/verify${search}`),
		getClientAddress: () => '203.0.113.6',
		setHeaders: vi.fn(),
		...overrides
	} as never;
}

function confirmEvent(token: string | null, overrides: Record<string, unknown> = {}) {
	const form = new Map<string, unknown>();
	if (token !== null) form.set('t', token);
	return {
		request: { formData: async () => ({ get: (k: string) => form.get(k) ?? null }) },
		cookies: {},
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

describe('load /login/verify (peek, no consume)', () => {
	it('renders the confirm interstitial for a live token without consuming it', async () => {
		mocks.peekAuthorSignIn.mockResolvedValue(true);

		await expect(load(loadEvent('?t=good'))).resolves.toEqual({ state: 'confirm', token: 'good' });
		expect(mocks.peekAuthorSignIn).toHaveBeenCalledWith('good');
		// The GET never consumes: a scanner prefetch cannot burn the token.
		expect(mocks.completeAuthorSignIn).not.toHaveBeenCalled();
		expect(mocks.setAuthorCookie).not.toHaveBeenCalled();
	});

	it('shows the neutral expired state for a dead token (used/expired/forged)', async () => {
		mocks.peekAuthorSignIn.mockResolvedValue(false);

		await expect(load(loadEvent('?t=dead'))).resolves.toEqual({ state: 'expired' });
		expect(mocks.completeAuthorSignIn).not.toHaveBeenCalled();
	});

	it('shows the neutral expired state on a bare landing with no token (no peek, no brake)', async () => {
		await expect(load(loadEvent(''))).resolves.toEqual({ state: 'expired' });
		expect(mocks.peekAuthorSignIn).not.toHaveBeenCalled();
		// An empty-token probe is bounded per-IP only, never charged to the global brake.
		expect(mocks.globalConsume).not.toHaveBeenCalled();
	});

	it('single mode: bounces to /login (no magic-link path), no peek', async () => {
		modeState.multi = false;

		await expect(load(loadEvent('?t=whatever'))).rejects.toMatchObject({
			status: 303,
			location: '/login'
		});
		expect(mocks.peekAuthorSignIn).not.toHaveBeenCalled();
	});

	it('a throttled landing returns the identical expired state (no 429 oracle, no peek)', async () => {
		mocks.perIpConsume.mockReturnValue({ allowed: false, retryAfterSeconds: 30 });

		await expect(load(loadEvent('?t=good'))).resolves.toEqual({ state: 'expired' });
		expect(mocks.peekAuthorSignIn).not.toHaveBeenCalled();
	});

	it('a non-empty token charges the global brake; an empty one does not', async () => {
		mocks.peekAuthorSignIn.mockResolvedValue(false);

		await load(loadEvent('?t=real'));
		expect(mocks.globalConsume).toHaveBeenCalledWith('global');

		mocks.globalConsume.mockClear();
		await load(loadEvent('?t='));
		expect(mocks.globalConsume).not.toHaveBeenCalled();
	});
});

describe('confirm action /login/verify (consume + mint)', () => {
	it('mints the session on a valid consume and redirects to /reports', async () => {
		mocks.completeAuthorSignIn.mockResolvedValue({ token: 'sess', expiresAt: new Date() });

		await expect(actions.confirm(confirmEvent('good'))).rejects.toMatchObject({
			status: 303,
			location: '/reports'
		});
		expect(mocks.completeAuthorSignIn).toHaveBeenCalledWith('good');
		expect(mocks.setAuthorCookie).toHaveBeenCalledOnce();
	});

	it('bounces to the expired state when the token is used/expired/forged (single-use)', async () => {
		mocks.completeAuthorSignIn.mockResolvedValue(null);

		await expect(actions.confirm(confirmEvent('dead'))).rejects.toMatchObject({
			status: 303,
			location: '/login?expired=1'
		});
		expect(mocks.setAuthorCookie).not.toHaveBeenCalled();
	});

	it('bounces to the expired state with no token field, never consuming', async () => {
		await expect(actions.confirm(confirmEvent(null))).rejects.toMatchObject({
			status: 303,
			location: '/login?expired=1'
		});
		expect(mocks.completeAuthorSignIn).not.toHaveBeenCalled();
	});

	it('single mode: bounces to /login and mints nothing', async () => {
		modeState.multi = false;

		await expect(actions.confirm(confirmEvent('whatever'))).rejects.toMatchObject({
			status: 303,
			location: '/login'
		});
		expect(mocks.completeAuthorSignIn).not.toHaveBeenCalled();
		expect(mocks.setAuthorCookie).not.toHaveBeenCalled();
	});
});

describe('prefetch-safety (A1): a GET peek never consumes; the confirm POST still works', () => {
	it('peek then confirm: the same live token is consumed only by the POST', async () => {
		// Simulate a scanner GET-prefetch (the load) followed by the human click (the
		// confirm action). The peek does NOT consume, so the consume still succeeds.
		mocks.peekAuthorSignIn.mockResolvedValue(true);
		const prefetch = await load(loadEvent('?t=live'));
		expect(prefetch).toEqual({ state: 'confirm', token: 'live' });
		expect(mocks.completeAuthorSignIn).not.toHaveBeenCalled();

		mocks.completeAuthorSignIn.mockResolvedValue({ token: 'sess', expiresAt: new Date() });
		await expect(actions.confirm(confirmEvent('live'))).rejects.toMatchObject({
			status: 303,
			location: '/reports'
		});
		expect(mocks.completeAuthorSignIn).toHaveBeenCalledExactlyOnceWith('live');
	});
});
