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
	globalConsume: vi.fn()
}));

vi.mock('$lib/server/sharing', () => ({ getShareByToken: mocks.getShareByToken }));
vi.mock('$lib/server/auth/cookies', () => ({ setReaderCookie: mocks.setReaderCookie }));
vi.mock('$lib/server/auth/rate-limit', () => ({
	GLOBAL_VERIFICATION_KEY: 'global',
	verificationRateLimiter: { consume: mocks.verificationConsume },
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

	it('engages the rate limiter on every landing (forged ?t= floods)', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		mocks.completeVerification.mockResolvedValue(null);

		await expect(GET(event('?t=x'))).rejects.toBeDefined();

		expect(mocks.verificationConsume).toHaveBeenCalledWith('203.0.113.5:share-1');
		expect(mocks.globalConsume).toHaveBeenCalledWith('global');
	});
});
