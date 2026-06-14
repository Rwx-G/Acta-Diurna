import { beforeEach, describe, expect, it, vi } from 'vitest';

// Gate orchestration: assert the request/complete sequencing and the
// enumeration-safety posture (request always issues+sends; complete records
// identity + access + session only on a successful consume). All collaborators
// are mocked so this is a pure orchestration test.

const mocks = vi.hoisted(() => ({
	issueVerificationToken: vi.fn(),
	consumeVerificationToken: vi.fn(),
	peekVerificationToken: vi.fn(),
	hasLiveVerification: vi.fn(),
	findOrCreateIdentity: vi.fn(),
	recordAccess: vi.fn(),
	createReaderSession: vi.fn(),
	sendMail: vi.fn(),
	magicLinkEmail: vi.fn(),
	isAuthorizedReader: vi.fn(),
	isReaderEmailDomainAllowed: vi.fn(),
	loggerWarn: vi.fn()
}));

vi.mock('./verification', () => ({
	issueVerificationToken: mocks.issueVerificationToken,
	consumeVerificationToken: mocks.consumeVerificationToken,
	peekVerificationToken: mocks.peekVerificationToken,
	hasLiveVerification: mocks.hasLiveVerification
}));
vi.mock('./identities', () => ({
	findOrCreateIdentity: mocks.findOrCreateIdentity,
	recordAccess: mocks.recordAccess
}));
vi.mock('$lib/server/auth/sessions', () => ({
	createReaderSession: mocks.createReaderSession
}));
vi.mock('$lib/server/mail/send', () => ({ sendMail: mocks.sendMail }));
vi.mock('$lib/server/mail/templates/magic-link', () => ({ magicLinkEmail: mocks.magicLinkEmail }));
vi.mock('$lib/server/sharing', () => ({
	isAuthorizedReader: mocks.isAuthorizedReader,
	isReaderEmailDomainAllowed: mocks.isReaderEmailDomainAllowed
}));
vi.mock('$lib/server/logger', () => ({ logger: { warn: mocks.loggerWarn } }));

import { completeVerification, requestVerification } from './gate';

const OPEN_SHARE = { id: 'share-1', mode: 'open' as const };
const RESTRICTED_SHARE = { id: 'share-1', mode: 'restricted' as const };

function shareWith(overrides: Record<string, unknown>) {
	return { ...OPEN_SHARE, ...overrides } as never;
}

/** Lets the fire-and-forget send promise settle before assertions. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	for (const m of Object.values(mocks)) m.mockReset();
	mocks.isReaderEmailDomainAllowed.mockReturnValue(true);
	mocks.isAuthorizedReader.mockResolvedValue(true);
	mocks.hasLiveVerification.mockResolvedValue(false);
	mocks.issueVerificationToken.mockResolvedValue({ token: 'raw-token', expiresAt: new Date() });
	mocks.magicLinkEmail.mockReturnValue({ to: 'x', subject: 's', text: 't' });
	mocks.sendMail.mockResolvedValue({ messageId: 'id' });
});

describe('requestVerification (enumeration-safety)', () => {
	it('issues a token and sends the magic link for any authorized email', async () => {
		await requestVerification(
			shareWith({}),
			'reader@example.com',
			(t) => `https://x/verify?t=${t}`
		);
		await flush();

		expect(mocks.issueVerificationToken).toHaveBeenCalledWith('share-1', 'reader@example.com');
		expect(mocks.magicLinkEmail).toHaveBeenCalledWith(
			'reader@example.com',
			'https://x/verify?t=raw-token'
		);
		expect(mocks.sendMail).toHaveBeenCalledOnce();
	});

	it('does the same work for a different authorized email (no branch on the address)', async () => {
		await requestVerification(
			shareWith({}),
			'someone-else@example.com',
			(t) => `https://x/v?t=${t}`
		);
		await flush();

		expect(mocks.issueVerificationToken).toHaveBeenCalledWith(
			'share-1',
			'someone-else@example.com'
		);
		expect(mocks.sendMail).toHaveBeenCalledOnce();
	});

	it('restricted + on-list: a listed email gets a token and a mail (authorized)', async () => {
		mocks.isAuthorizedReader.mockResolvedValue(true);

		await requestVerification(
			RESTRICTED_SHARE as never,
			'on@list.com',
			(t) => `https://x/v?t=${t}`
		);
		await flush();

		expect(mocks.isAuthorizedReader).toHaveBeenCalledWith(RESTRICTED_SHARE, 'on@list.com');
		expect(mocks.issueVerificationToken).toHaveBeenCalledWith('share-1', 'on@list.com');
		expect(mocks.sendMail).toHaveBeenCalledOnce();
	});

	it('restricted + off-list: an unlisted email issues NO token and sends NO mail', async () => {
		mocks.isAuthorizedReader.mockResolvedValue(false);

		await requestVerification(
			RESTRICTED_SHARE as never,
			'off@list.com',
			(t) => `https://x/v?t=${t}`
		);
		await flush();

		expect(mocks.isAuthorizedReader).toHaveBeenCalledWith(RESTRICTED_SHARE, 'off@list.com');
		expect(mocks.issueVerificationToken).not.toHaveBeenCalled();
		expect(mocks.hasLiveVerification).not.toHaveBeenCalled();
		expect(mocks.sendMail).not.toHaveBeenCalled();
	});

	it('enumeration-safety: off-list and on-list return the IDENTICAL void result', async () => {
		mocks.isAuthorizedReader.mockResolvedValue(false);
		const offList = await requestVerification(
			RESTRICTED_SHARE as never,
			'off@list.com',
			(t) => `https://x/v?t=${t}`
		);

		mocks.isAuthorizedReader.mockResolvedValue(true);
		const onList = await requestVerification(
			RESTRICTED_SHARE as never,
			'on@list.com',
			(t) => `https://x/v?t=${t}`
		);

		expect(offList).toBe(onList);
		expect(offList).toBeUndefined();
	});

	it('timing: neither path awaits SMTP - returns before sendMail settles', async () => {
		// A send that never resolves must not hang the call. If the response awaited
		// the send, this would time out; instead it returns immediately and the send
		// floats. This is the timing-equivalence guarantee: SMTP latency is off the
		// response path on BOTH the authorized and unauthorized paths.
		let release: (() => void) | undefined;
		mocks.sendMail.mockReturnValue(
			new Promise<{ messageId: string }>((resolve) => {
				release = () => resolve({ messageId: 'id' });
			})
		);

		await expect(
			requestVerification(shareWith({}), 'reader@example.com', (t) => `https://x/v?t=${t}`)
		).resolves.toBeUndefined();

		release?.();
		await flush();
	});

	it('a fire-and-forget send failure is logged, never thrown to the caller', async () => {
		mocks.sendMail.mockRejectedValue(new Error('smtp down'));

		await expect(
			requestVerification(shareWith({}), 'reader@example.com', (t) => `https://x/v?t=${t}`)
		).resolves.toBeUndefined();
		await flush();

		expect(mocks.loggerWarn).toHaveBeenCalledOnce();
	});

	it('dedup: a live verification already pending for (share, email) issues no new token and sends no second mail', async () => {
		mocks.hasLiveVerification.mockResolvedValue(true);

		await requestVerification(shareWith({}), 'reader@example.com', (t) => `https://x/v?t=${t}`);
		await flush();

		expect(mocks.hasLiveVerification).toHaveBeenCalledWith('share-1', 'reader@example.com');
		expect(mocks.issueVerificationToken).not.toHaveBeenCalled();
		expect(mocks.sendMail).not.toHaveBeenCalled();
	});

	it('dedup: suppression returns the same void result as a real send (enumeration-safe, no leak)', async () => {
		mocks.hasLiveVerification.mockResolvedValue(true);

		const suppressed = await requestVerification(
			shareWith({}),
			'reader@example.com',
			(t) => `https://x/v?t=${t}`
		);

		mocks.hasLiveVerification.mockResolvedValue(false);
		const sent = await requestVerification(
			shareWith({}),
			'reader@example.com',
			(t) => `https://x/v?t=${t}`
		);
		await flush();

		expect(suppressed).toBe(sent);
		expect(suppressed).toBeUndefined();
	});

	it('issues a fresh token once no live verification remains (consumed or expired)', async () => {
		mocks.hasLiveVerification.mockResolvedValue(false);

		await requestVerification(shareWith({}), 'reader@example.com', (t) => `https://x/v?t=${t}`);
		await flush();

		expect(mocks.issueVerificationToken).toHaveBeenCalledWith('share-1', 'reader@example.com');
		expect(mocks.sendMail).toHaveBeenCalledOnce();
	});

	it('domain allow-list (story 8.5): an allowed-domain email gets a token and a mail', async () => {
		mocks.isReaderEmailDomainAllowed.mockReturnValue(true);

		await requestVerification(shareWith({}), 'in@allowed.com', (t) => `https://x/v?t=${t}`);
		await flush();

		expect(mocks.isReaderEmailDomainAllowed).toHaveBeenCalledWith('in@allowed.com');
		expect(mocks.issueVerificationToken).toHaveBeenCalledWith('share-1', 'in@allowed.com');
		expect(mocks.sendMail).toHaveBeenCalledOnce();
	});

	it('domain allow-list: an off-domain email issues NO token and sends NO mail (no per-share read)', async () => {
		mocks.isReaderEmailDomainAllowed.mockReturnValue(false);

		await requestVerification(shareWith({}), 'out@blocked.com', (t) => `https://x/v?t=${t}`);
		await flush();

		expect(mocks.isReaderEmailDomainAllowed).toHaveBeenCalledWith('out@blocked.com');
		// The domain gate is first and short-circuits, so the per-share check, the
		// dedup read, the token insert and the mail are all skipped.
		expect(mocks.isAuthorizedReader).not.toHaveBeenCalled();
		expect(mocks.issueVerificationToken).not.toHaveBeenCalled();
		expect(mocks.hasLiveVerification).not.toHaveBeenCalled();
		expect(mocks.sendMail).not.toHaveBeenCalled();
	});

	it('domain allow-list: off-domain and on-domain return the IDENTICAL void result (enumeration-safe)', async () => {
		mocks.isReaderEmailDomainAllowed.mockReturnValue(false);
		const offDomain = await requestVerification(
			shareWith({}),
			'out@blocked.com',
			(t) => `https://x/v?t=${t}`
		);

		mocks.isReaderEmailDomainAllowed.mockReturnValue(true);
		const onDomain = await requestVerification(
			shareWith({}),
			'in@allowed.com',
			(t) => `https://x/v?t=${t}`
		);

		expect(offDomain).toBe(onDomain);
		expect(offDomain).toBeUndefined();
	});

	it('domain allow-list layers with the per-share list: both must pass to issue a token', async () => {
		// Domain allowed but off the per-share recipient list: still refused, no token.
		mocks.isReaderEmailDomainAllowed.mockReturnValue(true);
		mocks.isAuthorizedReader.mockResolvedValue(false);

		await requestVerification(
			RESTRICTED_SHARE as never,
			'in@allowed.com',
			(t) => `https://x/v?t=${t}`
		);
		await flush();

		expect(mocks.issueVerificationToken).not.toHaveBeenCalled();
		expect(mocks.sendMail).not.toHaveBeenCalled();
	});
});

describe('completeVerification', () => {
	it('on a valid consume: records identity + access, opens a per-share session', async () => {
		mocks.consumeVerificationToken.mockResolvedValue({
			shareId: 'share-1',
			email: 'reader@example.com'
		});
		mocks.findOrCreateIdentity.mockResolvedValue('identity-1');
		mocks.createReaderSession.mockResolvedValue({ token: 'sess', expiresAt: new Date() });

		const result = await completeVerification('raw', 'share-1', 'report-1');

		expect(mocks.consumeVerificationToken).toHaveBeenCalledWith('raw', 'share-1');
		expect(mocks.findOrCreateIdentity).toHaveBeenCalledWith('reader@example.com');
		expect(mocks.recordAccess).toHaveBeenCalledWith('identity-1', 'share-1', 'report-1');
		expect(mocks.createReaderSession).toHaveBeenCalledWith({
			shareId: 'share-1',
			reportId: 'report-1',
			readerIdentityId: 'identity-1'
		});
		expect(result).toEqual({
			session: { token: 'sess', expiresAt: expect.any(Date) },
			reportId: 'report-1'
		});
	});

	it('on a failed consume: no identity, no access, no session, returns null', async () => {
		mocks.consumeVerificationToken.mockResolvedValue(null);

		const result = await completeVerification('raw', 'share-1', 'report-1');

		expect(result).toBeNull();
		expect(mocks.findOrCreateIdentity).not.toHaveBeenCalled();
		expect(mocks.recordAccess).not.toHaveBeenCalled();
		expect(mocks.createReaderSession).not.toHaveBeenCalled();
	});
});
