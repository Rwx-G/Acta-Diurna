import { beforeEach, describe, expect, it, vi } from 'vitest';

// Reader magic-link landing behavior (A1 prefetch-safe interstitial): the GET `load`
// PEEKS without consuming. A closed share is the neutral 404; single mode bounces to
// expired; a live token for THIS share renders the confirm interstitial; a
// dead/empty/throttled token shows the neutral expired state; NO consume happens on
// the GET. The `confirm` action consumes: a valid token sets the reader cookie and
// redirects to the report, a dead token bounces to expired. SvelteKit's redirect()
// throws, so redirect paths are asserted as thrown objects.

const mocks = vi.hoisted(() => ({
	getShareByToken: vi.fn(),
	isMultiAuthor: vi.fn(),
	setReaderCookie: vi.fn(),
	peekVerification: vi.fn(),
	completeVerification: vi.fn(),
	verificationConsume: vi.fn(),
	shareConsume: vi.fn(),
	globalConsume: vi.fn()
}));

vi.mock('$lib/server/sharing', () => ({ getShareByToken: mocks.getShareByToken }));
vi.mock('$lib/server/mode', () => ({ isMultiAuthor: mocks.isMultiAuthor }));
vi.mock('$lib/server/auth/cookies', () => ({ setReaderCookie: mocks.setReaderCookie }));
vi.mock('$lib/server/auth/rate-limit', () => ({
	GLOBAL_VERIFICATION_KEY: 'global',
	verificationRateLimiter: { consume: mocks.verificationConsume },
	verificationShareLimiter: { consume: mocks.shareConsume },
	verificationFailureLimiter: { consume: mocks.globalConsume }
}));
vi.mock('$lib/server/reader', () => ({
	peekVerification: mocks.peekVerification,
	completeVerification: mocks.completeVerification,
	serveNeutralClosed: (setHeaders: (h: Record<string, string>) => void) => {
		setHeaders({ 'cache-control': 'no-store' });
		throw { __neutral404: true };
	}
}));

import { load, actions } from './+page.server';

const ACTIVE_SHARE = { id: 'share-1', reportId: 'report-1', status: 'active' as const };

function loadEvent(search: string, overrides: Record<string, unknown> = {}) {
	return {
		params: { token: 'tok' },
		url: new URL(`https://host/r/tok/verify${search}`),
		getClientAddress: () => '203.0.113.5',
		setHeaders: vi.fn(),
		...overrides
	} as never;
}

function confirmEvent(token: string | null, overrides: Record<string, unknown> = {}) {
	const form = new Map<string, unknown>();
	if (token !== null) form.set('t', token);
	return {
		params: { token: 'tok' },
		request: { formData: async () => ({ get: (k: string) => form.get(k) ?? null }) },
		cookies: {},
		setHeaders: vi.fn(),
		...overrides
	} as never;
}

beforeEach(() => {
	for (const m of Object.values(mocks)) m.mockReset();
	mocks.verificationConsume.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
	mocks.shareConsume.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
	mocks.globalConsume.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
	// The magic-link landing only exists in MULTI mode; default the suite there.
	mocks.isMultiAuthor.mockReturnValue(true);
});

describe('load /r/[token]/verify (peek, no consume)', () => {
	it('serves the neutral 404 for a closed share', async () => {
		mocks.getShareByToken.mockResolvedValue({ ...ACTIVE_SHARE, status: 'revoked' });

		await expect(load(loadEvent('?t=abc'))).rejects.toMatchObject({ __neutral404: true });
		expect(mocks.peekVerification).not.toHaveBeenCalled();
		expect(mocks.completeVerification).not.toHaveBeenCalled();
	});

	it('renders the confirm interstitial for a live token without consuming it', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		mocks.peekVerification.mockResolvedValue(true);

		await expect(load(loadEvent('?t=good'))).resolves.toEqual({ state: 'confirm', token: 'good' });
		expect(mocks.peekVerification).toHaveBeenCalledWith('good', 'share-1');
		// The GET never consumes: a scanner prefetch cannot burn the token.
		expect(mocks.completeVerification).not.toHaveBeenCalled();
		expect(mocks.setReaderCookie).not.toHaveBeenCalled();
	});

	it('shows the neutral expired state for a dead/used/wrong-share token', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		mocks.peekVerification.mockResolvedValue(false);

		await expect(load(loadEvent('?t=dead'))).resolves.toEqual({ state: 'expired' });
		expect(mocks.completeVerification).not.toHaveBeenCalled();
	});

	it('shows the neutral expired state on a bare landing with no token (no peek, no shared brakes)', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);

		await expect(load(loadEvent(''))).resolves.toEqual({ state: 'expired' });
		await expect(load(loadEvent('?t='))).resolves.toEqual({ state: 'expired' });

		expect(mocks.verificationConsume).toHaveBeenCalledTimes(2);
		expect(mocks.shareConsume).not.toHaveBeenCalled();
		expect(mocks.globalConsume).not.toHaveBeenCalled();
		expect(mocks.peekVerification).not.toHaveBeenCalled();
	});

	it('when the per-IP limiter denies: no peek, returns the indistinguishable expired state', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		mocks.verificationConsume.mockReturnValue({ allowed: false, retryAfterSeconds: 30 });

		await expect(load(loadEvent('?t=good'))).resolves.toEqual({ state: 'expired' });
		expect(mocks.peekVerification).not.toHaveBeenCalled();
	});

	it('when the per-share brake denies: same expired state, no peek (one share cannot starve all)', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		mocks.shareConsume.mockReturnValue({ allowed: false, retryAfterSeconds: 5 });

		await expect(load(loadEvent('?t=good'))).resolves.toEqual({ state: 'expired' });
		expect(mocks.peekVerification).not.toHaveBeenCalled();
		// The per-share brake short-circuits BEFORE the global brake.
		expect(mocks.globalConsume).not.toHaveBeenCalled();
	});

	it('when the global brake denies: same expired state, no peek (proxy-collapse second line)', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		mocks.globalConsume.mockReturnValue({ allowed: false, retryAfterSeconds: 10 });

		await expect(load(loadEvent('?t=good'))).resolves.toEqual({ state: 'expired' });
		expect(mocks.peekVerification).not.toHaveBeenCalled();
	});

	it('a real (non-empty) token attempt charges the per-share/global brakes', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		mocks.peekVerification.mockResolvedValue(false);

		await load(loadEvent('?t=real'));

		expect(mocks.verificationConsume).toHaveBeenCalledWith('203.0.113.5:share-1');
		expect(mocks.shareConsume).toHaveBeenCalledWith('share-1');
		expect(mocks.globalConsume).toHaveBeenCalledWith('global');
		expect(mocks.peekVerification).toHaveBeenCalledWith('real', 'share-1');
	});

	it('single mode: the landing opens NO session - it bounces to expired, no peek (story 8.4)', async () => {
		mocks.isMultiAuthor.mockReturnValue(false);
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);

		await expect(load(loadEvent('?t=stillvalid'))).rejects.toMatchObject({
			status: 303,
			location: '/r/tok?expired=1'
		});
		expect(mocks.peekVerification).not.toHaveBeenCalled();
		expect(mocks.completeVerification).not.toHaveBeenCalled();
		expect(mocks.setReaderCookie).not.toHaveBeenCalled();
	});
});

describe('confirm action /r/[token]/verify (consume + session)', () => {
	it('serves the neutral 404 for a closed share', async () => {
		mocks.getShareByToken.mockResolvedValue({ ...ACTIVE_SHARE, status: 'revoked' });

		await expect(actions.confirm(confirmEvent('abc'))).rejects.toMatchObject({
			__neutral404: true
		});
		expect(mocks.completeVerification).not.toHaveBeenCalled();
	});

	it('on success: sets the reader cookie and redirects to the report', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		const expiresAt = new Date(Date.now() + 1000);
		mocks.completeVerification.mockResolvedValue({
			session: { token: 'sess-token', expiresAt },
			reportId: 'report-1'
		});
		const cookies = {};

		await expect(actions.confirm(confirmEvent('good', { cookies }))).rejects.toMatchObject({
			status: 303,
			location: '/r/tok'
		});
		expect(mocks.setReaderCookie).toHaveBeenCalledWith(cookies, 'sess-token', expiresAt);
		expect(mocks.completeVerification).toHaveBeenCalledWith('good', 'share-1', 'report-1');
	});

	it('bounces to the expired state when the token is used/expired/wrong-share', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		mocks.completeVerification.mockResolvedValue(null);

		await expect(actions.confirm(confirmEvent('dead'))).rejects.toMatchObject({
			status: 303,
			location: '/r/tok?expired=1'
		});
		expect(mocks.setReaderCookie).not.toHaveBeenCalled();
	});

	it('bounces to the expired state with no token field, never consuming', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);

		await expect(actions.confirm(confirmEvent(null))).rejects.toMatchObject({
			status: 303,
			location: '/r/tok?expired=1'
		});
		expect(mocks.completeVerification).not.toHaveBeenCalled();
	});

	it('single mode: bounces to expired and opens no session', async () => {
		mocks.isMultiAuthor.mockReturnValue(false);
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);

		await expect(actions.confirm(confirmEvent('whatever'))).rejects.toMatchObject({
			status: 303,
			location: '/r/tok?expired=1'
		});
		expect(mocks.completeVerification).not.toHaveBeenCalled();
		expect(mocks.setReaderCookie).not.toHaveBeenCalled();
	});
});

describe('prefetch-safety (A1): a GET peek never consumes; the confirm POST still works', () => {
	it('peek then confirm: the same live token is consumed only by the POST', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		mocks.peekVerification.mockResolvedValue(true);
		const prefetch = await load(loadEvent('?t=live'));
		expect(prefetch).toEqual({ state: 'confirm', token: 'live' });
		expect(mocks.completeVerification).not.toHaveBeenCalled();

		mocks.completeVerification.mockResolvedValue({
			session: { token: 'sess', expiresAt: new Date(Date.now() + 1000) },
			reportId: 'report-1'
		});
		await expect(actions.confirm(confirmEvent('live'))).rejects.toMatchObject({
			status: 303,
			location: '/r/tok'
		});
		expect(mocks.completeVerification).toHaveBeenCalledExactlyOnceWith(
			'live',
			'share-1',
			'report-1'
		);
	});
});
