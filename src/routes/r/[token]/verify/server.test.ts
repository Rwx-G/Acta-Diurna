import { beforeEach, describe, expect, it, vi } from 'vitest';

// Magic-link landing behavior: a closed share is the neutral 404; a failed
// consume bounces to the expired state; a successful consume sets the reader
// cookie and redirects to the report. SvelteKit's redirect() throws, so the
// success/expired paths are asserted as thrown redirect objects.

const mocks = vi.hoisted(() => ({
	getShareByToken: vi.fn(),
	setReaderCookie: vi.fn(),
	completeVerification: vi.fn(),
	verificationConsume: vi.fn(),
	shareConsume: vi.fn(),
	globalConsume: vi.fn()
}));

vi.mock('$lib/server/sharing', () => ({ getShareByToken: mocks.getShareByToken }));
vi.mock('$lib/server/auth/cookies', () => ({ setReaderCookie: mocks.setReaderCookie }));
vi.mock('$lib/server/auth/rate-limit', () => ({
	GLOBAL_VERIFICATION_KEY: 'global',
	verificationRateLimiter: { consume: mocks.verificationConsume },
	verificationShareLimiter: { consume: mocks.shareConsume },
	verificationFailureLimiter: { consume: mocks.globalConsume }
}));
vi.mock('$lib/server/reader', () => ({
	completeVerification: mocks.completeVerification,
	serveNeutralClosed: (setHeaders: (h: Record<string, string>) => void) => {
		setHeaders({ 'cache-control': 'no-store' });
		throw { __neutral404: true };
	}
}));

import { GET } from './+server';

const ACTIVE_SHARE = { id: 'share-1', reportId: 'report-1', status: 'active' as const };

function event(search: string, overrides: Record<string, unknown> = {}) {
	return {
		params: { token: 'tok' },
		url: new URL(`https://host/r/tok/verify${search}`),
		cookies: {},
		getClientAddress: () => '203.0.113.5',
		setHeaders: vi.fn(),
		...overrides
	} as never;
}

beforeEach(() => {
	for (const m of Object.values(mocks)) m.mockReset();
	mocks.verificationConsume.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
	mocks.shareConsume.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
	mocks.globalConsume.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
});

describe('GET /r/[token]/verify', () => {
	it('serves the neutral 404 for a closed share', async () => {
		mocks.getShareByToken.mockResolvedValue({ ...ACTIVE_SHARE, status: 'revoked' });

		await expect(GET(event('?t=abc'))).rejects.toMatchObject({ __neutral404: true });
		expect(mocks.completeVerification).not.toHaveBeenCalled();
	});

	it('bounces to the expired state when the token is used/expired/wrong-share', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		mocks.completeVerification.mockResolvedValue(null);

		await expect(GET(event('?t=dead'))).rejects.toMatchObject({
			status: 303,
			location: '/r/tok?expired=1'
		});
		expect(mocks.setReaderCookie).not.toHaveBeenCalled();
	});

	it('on success: sets the reader cookie and redirects to the report', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		const expiresAt = new Date(Date.now() + 1000);
		mocks.completeVerification.mockResolvedValue({
			session: { token: 'sess-token', expiresAt },
			reportId: 'report-1'
		});
		const cookies = {};
		const ev = event('?t=good', { cookies });

		await expect(GET(ev)).rejects.toMatchObject({ status: 303, location: '/r/tok' });
		expect(mocks.setReaderCookie).toHaveBeenCalledWith(cookies, 'sess-token', expiresAt);
		expect(mocks.completeVerification).toHaveBeenCalledWith('good', 'share-1', 'report-1');
	});

	it('when the per-IP limiter denies: does not consume the token, returns the indistinguishable expired bounce', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		mocks.verificationConsume.mockReturnValue({ allowed: false, retryAfterSeconds: 30 });

		await expect(GET(event('?t=good'))).rejects.toMatchObject({
			status: 303,
			location: '/r/tok?expired=1'
		});
		expect(mocks.completeVerification).not.toHaveBeenCalled();
		expect(mocks.setReaderCookie).not.toHaveBeenCalled();
	});

	it('when the per-share brake denies: same expired bounce, no consume (one share cannot starve all)', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		mocks.shareConsume.mockReturnValue({ allowed: false, retryAfterSeconds: 5 });

		await expect(GET(event('?t=good'))).rejects.toMatchObject({
			status: 303,
			location: '/r/tok?expired=1'
		});
		expect(mocks.completeVerification).not.toHaveBeenCalled();
		// The per-share brake short-circuits BEFORE the global brake, so the
		// instance-wide bucket is never drained by one share's flood.
		expect(mocks.globalConsume).not.toHaveBeenCalled();
	});

	it('when the global brake denies: same expired bounce, no consume (proxy-collapse second line)', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		mocks.globalConsume.mockReturnValue({ allowed: false, retryAfterSeconds: 10 });

		await expect(GET(event('?t=good'))).rejects.toMatchObject({
			status: 303,
			location: '/r/tok?expired=1'
		});
		expect(mocks.completeVerification).not.toHaveBeenCalled();
	});

	it('engages the rate limiter on every landing (forged ?t= floods)', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		mocks.completeVerification.mockResolvedValue(null);

		await expect(GET(event('?t=x'))).rejects.toBeDefined();

		expect(mocks.verificationConsume).toHaveBeenCalledWith('203.0.113.5:share-1');
		expect(mocks.shareConsume).toHaveBeenCalledWith('share-1');
		expect(mocks.globalConsume).toHaveBeenCalledWith('global');
	});

	it('an empty-token landing GET does NOT drain the per-share/global brakes (only the per-IP bucket)', async () => {
		// A party holding the public share link spams empty-token landing GETs. The
		// per-IP bucket still charges (a single IP stays bounded), but the shared
		// per-share and global brakes are left untouched, so the flood cannot lock
		// out new-reader verification on this share or any other.
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);

		// No `?t=` at all, then an explicitly empty `?t=`: both are empty attempts.
		await expect(GET(event(''))).rejects.toMatchObject({
			status: 303,
			location: '/r/tok?expired=1'
		});
		await expect(GET(event('?t='))).rejects.toMatchObject({
			status: 303,
			location: '/r/tok?expired=1'
		});

		expect(mocks.verificationConsume).toHaveBeenCalledTimes(2);
		expect(mocks.verificationConsume).toHaveBeenCalledWith('203.0.113.5:share-1');
		expect(mocks.shareConsume).not.toHaveBeenCalled();
		expect(mocks.globalConsume).not.toHaveBeenCalled();
		// An empty token never reaches the consume: it bounces straight to expired.
		expect(mocks.completeVerification).not.toHaveBeenCalled();
	});

	it('a real (non-empty) token attempt DOES charge the per-share/global brakes', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		mocks.completeVerification.mockResolvedValue(null);

		await expect(GET(event('?t=real'))).rejects.toBeDefined();

		expect(mocks.verificationConsume).toHaveBeenCalledWith('203.0.113.5:share-1');
		expect(mocks.shareConsume).toHaveBeenCalledWith('share-1');
		expect(mocks.globalConsume).toHaveBeenCalledWith('global');
		expect(mocks.completeVerification).toHaveBeenCalledWith('real', 'share-1', 'report-1');
	});

	it('an empty-token landing whose per-IP bucket is drained still bounces to expired (per-IP stays bounded)', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		mocks.verificationConsume.mockReturnValue({ allowed: false, retryAfterSeconds: 30 });

		await expect(GET(event(''))).rejects.toMatchObject({
			status: 303,
			location: '/r/tok?expired=1'
		});
		expect(mocks.shareConsume).not.toHaveBeenCalled();
		expect(mocks.globalConsume).not.toHaveBeenCalled();
	});
});
