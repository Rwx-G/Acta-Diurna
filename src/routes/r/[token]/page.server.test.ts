import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-level gate behavior. The services are mocked; this asserts the wiring:
// neutral 404 for closed/unknown shares, FR23 no-re-verify for a valid session,
// the email-prompt fallthrough, and the enumeration-safe action (identical
// `sent` for any plausible email, `invalid` for a malformed one, `throttled`
// under the limiter).

const mocks = vi.hoisted(() => ({
	getShareByToken: vi.fn(),
	readReaderCookie: vi.fn(),
	validateReaderSession: vi.fn(),
	getPublishedDocument: vi.fn(),
	requestVerification: vi.fn(),
	verificationConsume: vi.fn(),
	shareConsume: vi.fn(),
	globalConsume: vi.fn()
}));

vi.mock('$lib/server/sharing', () => ({ getShareByToken: mocks.getShareByToken }));
vi.mock('$lib/server/auth/cookies', () => ({ readReaderCookie: mocks.readReaderCookie }));
vi.mock('$lib/server/auth/sessions', () => ({
	validateReaderSession: mocks.validateReaderSession
}));
vi.mock('$lib/server/documents/reports', () => ({
	getPublishedDocument: mocks.getPublishedDocument
}));
vi.mock('$lib/server/auth/rate-limit', () => ({
	GLOBAL_VERIFICATION_KEY: 'global',
	verificationRateLimiter: { consume: mocks.verificationConsume },
	verificationShareLimiter: { consume: mocks.shareConsume },
	verificationFailureLimiter: { consume: mocks.globalConsume }
}));
vi.mock('$lib/server/reader', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/reader')>('$lib/server/reader');
	return {
		// Keep the real email helpers (normalize/isPlausible) so the action's
		// validation is genuinely exercised; mock only the orchestration + neutral.
		normalizeEmail: actual.normalizeEmail,
		isPlausibleEmail: actual.isPlausibleEmail,
		requestVerification: mocks.requestVerification,
		serveNeutralClosed: (setHeaders: (h: Record<string, string>) => void) => {
			setHeaders({ 'cache-control': 'no-store' });
			throw { __neutral404: true };
		}
	};
});

import { AppError } from '$lib/server/problem';
import { actions, load } from './+page.server';

const ACTIVE_SHARE = {
	id: 'share-1',
	reportId: 'report-1',
	mode: 'open' as const,
	expiresAt: null,
	createdAt: new Date(),
	revokedAt: null,
	status: 'active' as const
};

function loadEvent(overrides: Record<string, unknown> = {}) {
	const setHeaders = vi.fn();
	const event = {
		params: { token: 'tok' },
		url: new URL('https://host/r/tok'),
		cookies: {},
		setHeaders,
		...overrides
	};
	return { event: event as never, setHeaders };
}

function actionEvent(form: Record<string, string>, overrides: Record<string, unknown> = {}) {
	const body = new URLSearchParams(form);
	return {
		params: { token: 'tok' },
		url: new URL('https://host/r/tok'),
		request: { formData: () => Promise.resolve(body) },
		locals: { requestId: 'req-1' },
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

describe('load (the gate)', () => {
	it('serves the neutral 404 for an unknown token', async () => {
		mocks.getShareByToken.mockResolvedValue(null);
		const { event, setHeaders } = loadEvent();

		await expect(load(event)).rejects.toMatchObject({ __neutral404: true });
		expect(setHeaders).toHaveBeenCalledWith({ 'cache-control': 'no-store' });
	});

	it('serves the neutral 404 for a revoked share (no leak)', async () => {
		mocks.getShareByToken.mockResolvedValue({ ...ACTIVE_SHARE, status: 'revoked' });

		await expect(load(loadEvent().event)).rejects.toMatchObject({ __neutral404: true });
	});

	it('serves the neutral 404 for an expired share', async () => {
		mocks.getShareByToken.mockResolvedValue({ ...ACTIVE_SHARE, status: 'expired' });

		await expect(load(loadEvent().event)).rejects.toMatchObject({ __neutral404: true });
	});

	it('cuts off a live reader session the moment the share is revoked (per-load liveness)', async () => {
		// A reader who verified earlier still holds a valid acta_reader cookie. The
		// share has since been revoked. The gate re-checks share.status on EVERY load
		// and short-circuits to the neutral 404 BEFORE it even reads the session - so
		// a persistent session cannot outlive its share (FR23 "while the share remains
		// valid"). The session validator is never consulted.
		mocks.getShareByToken.mockResolvedValue({ ...ACTIVE_SHARE, status: 'revoked' });
		mocks.readReaderCookie.mockReturnValue('still-live-reader-token');
		mocks.validateReaderSession.mockResolvedValue({ id: 's', shareId: 'share-1' });
		const { event, setHeaders } = loadEvent();

		await expect(load(event)).rejects.toMatchObject({ __neutral404: true });
		expect(setHeaders).toHaveBeenCalledWith({ 'cache-control': 'no-store' });
		// The liveness check fires before the session is read - no published doc served.
		expect(mocks.validateReaderSession).not.toHaveBeenCalled();
		expect(mocks.getPublishedDocument).not.toHaveBeenCalled();
	});

	it('cuts off a live reader session the moment the share expires', async () => {
		mocks.getShareByToken.mockResolvedValue({ ...ACTIVE_SHARE, status: 'expired' });
		mocks.readReaderCookie.mockReturnValue('still-live-reader-token');
		mocks.validateReaderSession.mockResolvedValue({ id: 's', shareId: 'share-1' });

		await expect(load(loadEvent().event)).rejects.toMatchObject({ __neutral404: true });
		expect(mocks.getPublishedDocument).not.toHaveBeenCalled();
	});

	it('FR23: a valid reader session for THIS share serves the report, no re-verify', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		mocks.readReaderCookie.mockReturnValue('reader-token');
		mocks.validateReaderSession.mockResolvedValue({ id: 's', shareId: 'share-1' });
		mocks.getPublishedDocument.mockResolvedValue({ version: 1, title: 'Doc', sections: [] });

		const result = await load(loadEvent().event);

		expect(mocks.validateReaderSession).toHaveBeenCalledWith('reader-token', 'share-1');
		expect(result).toMatchObject({ state: 'verified', renderError: null });
	});

	it('serves the neutral 404 (not a 409) when the report was unpublished after the share went live', async () => {
		// Active share, valid session, but the report has no live published snapshot:
		// getPublishedDocument throws the 409 not-shareable AppError. The gate must
		// route that through the SAME neutral 404 as a revoked/expired/unknown share,
		// not surface a distinguishable 409 (NFR9 enumeration oracle).
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		mocks.readReaderCookie.mockReturnValue('reader-token');
		mocks.validateReaderSession.mockResolvedValue({ id: 's', shareId: 'share-1' });
		mocks.getPublishedDocument.mockRejectedValue(
			new AppError({
				status: 409,
				title: 'Report is not published',
				type: '/problems/report-not-published'
			})
		);
		const { event, setHeaders } = loadEvent();

		await expect(load(event)).rejects.toMatchObject({ __neutral404: true });
		expect(setHeaders).toHaveBeenCalledWith({ 'cache-control': 'no-store' });
	});

	it('prompts for email when active and no session', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		mocks.readReaderCookie.mockReturnValue(null);

		const result = await load(loadEvent().event);

		expect(result).toEqual({ state: 'prompt' });
	});

	it('shows the expired card state when ?expired=1 and no session', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		mocks.readReaderCookie.mockReturnValue(null);

		const result = await load(loadEvent({ url: new URL('https://host/r/tok?expired=1') }).event);

		expect(result).toEqual({ state: 'expired' });
	});
});

describe('request-verification action (enumeration-safety)', () => {
	it('returns the neutral "sent" for a known-looking email', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		mocks.requestVerification.mockResolvedValue(undefined);

		const result = await actions['request-verification'](actionEvent({ email: 'a@example.com' }));

		expect(result).toEqual({ state: 'sent' });
		// The action passes the RESOLVED share (not just its id) so the gate can read
		// `mode` for the restricted allow-list check (3.4).
		expect(mocks.requestVerification).toHaveBeenCalledWith(
			ACTIVE_SHARE,
			'a@example.com',
			expect.any(Function),
			'req-1'
		);
	});

	it('returns the SAME neutral "sent" for a different email (no enumeration)', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		mocks.requestVerification.mockResolvedValue(undefined);

		const result = await actions['request-verification'](actionEvent({ email: 'other@x.org' }));

		expect(result).toEqual({ state: 'sent' });
	});

	it('still returns neutral "sent" when the mailer throws (no leak of a real send)', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		mocks.requestVerification.mockRejectedValue(new Error('smtp down'));

		const result = await actions['request-verification'](actionEvent({ email: 'a@example.com' }));

		expect(result).toEqual({ state: 'sent' });
	});

	it('returns the form-shape "invalid" for a malformed email (not an auth signal)', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);

		const result = await actions['request-verification'](actionEvent({ email: 'not-an-email' }));

		expect(result).toMatchObject({ status: 400, data: { state: 'invalid' } });
		expect(mocks.requestVerification).not.toHaveBeenCalled();
	});

	it('returns "throttled" when the per-IP limiter trips', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		mocks.verificationConsume.mockReturnValue({ allowed: false, retryAfterSeconds: 30 });

		const result = await actions['request-verification'](actionEvent({ email: 'a@example.com' }));

		expect(result).toMatchObject({ status: 429, data: { state: 'throttled' } });
		expect(mocks.requestVerification).not.toHaveBeenCalled();
	});

	it('returns "throttled" when the per-share brake trips, BEFORE draining the global bucket', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		mocks.shareConsume.mockReturnValue({ allowed: false, retryAfterSeconds: 5 });

		const result = await actions['request-verification'](actionEvent({ email: 'a@example.com' }));

		expect(result).toMatchObject({ status: 429, data: { state: 'throttled' } });
		expect(mocks.requestVerification).not.toHaveBeenCalled();
		// The per-share brake short-circuits before the global brake, so one share's
		// flood never drains the instance-wide bucket.
		expect(mocks.globalConsume).not.toHaveBeenCalled();
	});

	it('throttles the drained share while a DIFFERENT share still passes (no cross-share starvation)', async () => {
		// The per-share brake is keyed by share id: when share-1's bucket is drained
		// it is throttled, but share-2 (a distinct key) is unaffected. The mock keys
		// its decision on the share id it is consumed with, mirroring the real
		// per-share limiter.
		mocks.requestVerification.mockResolvedValue(undefined);
		mocks.shareConsume.mockImplementation((shareId: string) =>
			shareId === 'share-1'
				? { allowed: false, retryAfterSeconds: 5 }
				: { allowed: true, retryAfterSeconds: 0 }
		);

		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		const drained = await actions['request-verification'](actionEvent({ email: 'a@example.com' }));
		expect(drained).toMatchObject({ status: 429, data: { state: 'throttled' } });

		mocks.getShareByToken.mockResolvedValue({ ...ACTIVE_SHARE, id: 'share-2' });
		const other = await actions['request-verification'](actionEvent({ email: 'a@example.com' }));
		expect(other).toEqual({ state: 'sent' });
	});

	it('returns "throttled" when the global brake trips (proxy-collapse second line)', async () => {
		mocks.getShareByToken.mockResolvedValue(ACTIVE_SHARE);
		mocks.globalConsume.mockReturnValue({ allowed: false, retryAfterSeconds: 10 });

		const result = await actions['request-verification'](actionEvent({ email: 'a@example.com' }));

		expect(result).toMatchObject({ status: 429, data: { state: 'throttled' } });
	});

	it('serves the neutral 404 when the share is closed at submission time', async () => {
		mocks.getShareByToken.mockResolvedValue({ ...ACTIVE_SHARE, status: 'revoked' });

		await expect(
			actions['request-verification'](actionEvent({ email: 'a@example.com' }))
		).rejects.toMatchObject({ __neutral404: true });
	});
});
