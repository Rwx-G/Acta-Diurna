import { beforeEach, describe, expect, it, vi } from 'vitest';

// Author gate orchestration: assert the request/complete sequencing and the
// enumeration-safety posture (request issues+sends ONLY for an in-domain email,
// but returns the same void result for every email; complete consumes the token,
// mints the author, opens a session only on a successful consume). All
// collaborators are mocked so this is a pure orchestration test, mirroring the
// reader gate.test.ts style.

const mocks = vi.hoisted(() => ({
	issueAuthorVerificationToken: vi.fn(),
	consumeAuthorVerificationToken: vi.fn(),
	peekAuthorVerificationToken: vi.fn(),
	hasLiveAuthorVerification: vi.fn(),
	isAuthorEmailInDomain: vi.fn(),
	ensureAuthor: vi.fn(),
	createAuthorSession: vi.fn(),
	sendMail: vi.fn(),
	authorMagicLinkEmail: vi.fn(),
	loggerWarn: vi.fn()
}));

vi.mock('./author-verification', () => ({
	issueAuthorVerificationToken: mocks.issueAuthorVerificationToken,
	consumeAuthorVerificationToken: mocks.consumeAuthorVerificationToken,
	peekAuthorVerificationToken: mocks.peekAuthorVerificationToken,
	hasLiveAuthorVerification: mocks.hasLiveAuthorVerification
}));
vi.mock('./author-domain', () => ({ isAuthorEmailInDomain: mocks.isAuthorEmailInDomain }));
vi.mock('$lib/server/authors', () => ({ ensureAuthor: mocks.ensureAuthor }));
vi.mock('./sessions', () => ({ createAuthorSession: mocks.createAuthorSession }));
vi.mock('$lib/server/mail/send', () => ({ sendMail: mocks.sendMail }));
vi.mock('$lib/server/mail/templates/author-magic-link', () => ({
	authorMagicLinkEmail: mocks.authorMagicLinkEmail
}));
vi.mock('$lib/server/logger', () => ({ logger: { warn: mocks.loggerWarn } }));

import { completeAuthorSignIn, requestAuthorSignIn } from './author-gate';

/** Lets the fire-and-forget send promise settle before assertions. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	for (const m of Object.values(mocks)) m.mockReset();
	mocks.isAuthorEmailInDomain.mockReturnValue(true);
	mocks.hasLiveAuthorVerification.mockResolvedValue(false);
	mocks.issueAuthorVerificationToken.mockResolvedValue({
		token: 'raw-token',
		expiresAt: new Date()
	});
	mocks.authorMagicLinkEmail.mockReturnValue({ to: 'x', subject: 's', text: 't' });
	mocks.sendMail.mockResolvedValue({ messageId: 'id' });
});

describe('requestAuthorSignIn (enumeration-safety)', () => {
	it('issues a token and sends the sign-in link for an in-domain email', async () => {
		await requestAuthorSignIn('author@example.com', (t) => `https://x/login/verify?t=${t}`);
		await flush();

		expect(mocks.issueAuthorVerificationToken).toHaveBeenCalledWith('author@example.com');
		expect(mocks.authorMagicLinkEmail).toHaveBeenCalledWith(
			'author@example.com',
			'https://x/login/verify?t=raw-token'
		);
		expect(mocks.sendMail).toHaveBeenCalledOnce();
	});

	it('off-domain: an out-of-domain email issues NO token, mints nothing, sends NO mail', async () => {
		mocks.isAuthorEmailInDomain.mockReturnValue(false);

		await requestAuthorSignIn('outsider@other.com', (t) => `https://x/login/verify?t=${t}`);
		await flush();

		expect(mocks.isAuthorEmailInDomain).toHaveBeenCalledWith('outsider@other.com');
		expect(mocks.issueAuthorVerificationToken).not.toHaveBeenCalled();
		expect(mocks.hasLiveAuthorVerification).not.toHaveBeenCalled();
		expect(mocks.ensureAuthor).not.toHaveBeenCalled();
		expect(mocks.sendMail).not.toHaveBeenCalled();
	});

	it('enumeration-safety: off-domain and in-domain return the IDENTICAL void result', async () => {
		mocks.isAuthorEmailInDomain.mockReturnValue(false);
		const offDomain = await requestAuthorSignIn(
			'outsider@other.com',
			(t) => `https://x/login/verify?t=${t}`
		);

		mocks.isAuthorEmailInDomain.mockReturnValue(true);
		const inDomain = await requestAuthorSignIn(
			'author@example.com',
			(t) => `https://x/login/verify?t=${t}`
		);

		expect(offDomain).toBe(inDomain);
		expect(offDomain).toBeUndefined();
	});

	it('timing: the in-domain path does not await SMTP - returns before sendMail settles', async () => {
		let release: (() => void) | undefined;
		mocks.sendMail.mockReturnValue(
			new Promise<{ messageId: string }>((resolve) => {
				release = () => resolve({ messageId: 'id' });
			})
		);

		await expect(
			requestAuthorSignIn('author@example.com', (t) => `https://x/login/verify?t=${t}`)
		).resolves.toBeUndefined();

		release?.();
		await flush();
	});

	it('a fire-and-forget send failure is logged, never thrown to the caller', async () => {
		mocks.sendMail.mockRejectedValue(new Error('smtp down'));

		await expect(
			requestAuthorSignIn('author@example.com', (t) => `https://x/login/verify?t=${t}`)
		).resolves.toBeUndefined();
		await flush();

		expect(mocks.loggerWarn).toHaveBeenCalledOnce();
	});

	it('dedup: a live verification already pending for the email issues no new token and sends no second mail', async () => {
		mocks.hasLiveAuthorVerification.mockResolvedValue(true);

		await requestAuthorSignIn('author@example.com', (t) => `https://x/login/verify?t=${t}`);
		await flush();

		expect(mocks.hasLiveAuthorVerification).toHaveBeenCalledWith('author@example.com');
		expect(mocks.issueAuthorVerificationToken).not.toHaveBeenCalled();
		expect(mocks.sendMail).not.toHaveBeenCalled();
	});
});

describe('completeAuthorSignIn', () => {
	it('on a valid consume: mints the author and opens a session bound to the author id', async () => {
		mocks.consumeAuthorVerificationToken.mockResolvedValue('author@example.com');
		mocks.ensureAuthor.mockResolvedValue('author-id-1');
		mocks.createAuthorSession.mockResolvedValue({ token: 'sess', expiresAt: new Date() });

		const result = await completeAuthorSignIn('raw');

		expect(mocks.consumeAuthorVerificationToken).toHaveBeenCalledWith('raw');
		expect(mocks.ensureAuthor).toHaveBeenCalledWith('author@example.com');
		// The session carries the minted author id - this is what makes tenancy real.
		expect(mocks.createAuthorSession).toHaveBeenCalledWith('author-id-1');
		expect(result).toEqual({ token: 'sess', expiresAt: expect.any(Date) });
	});

	it('mints the author on FIRST sign-in (ensureAuthor is the self-service provisioning)', async () => {
		mocks.consumeAuthorVerificationToken.mockResolvedValue('new-author@example.com');
		mocks.ensureAuthor.mockResolvedValue('author-id-2');
		mocks.createAuthorSession.mockResolvedValue({ token: 'sess', expiresAt: new Date() });

		await completeAuthorSignIn('raw');

		expect(mocks.ensureAuthor).toHaveBeenCalledExactlyOnceWith('new-author@example.com');
	});

	it('on a failed consume: no author minted, no session, returns null', async () => {
		mocks.consumeAuthorVerificationToken.mockResolvedValue(null);

		const result = await completeAuthorSignIn('raw');

		expect(result).toBeNull();
		expect(mocks.ensureAuthor).not.toHaveBeenCalled();
		expect(mocks.createAuthorSession).not.toHaveBeenCalled();
	});

	it('re-checks the domain at consume: a now-out-of-domain email mints nothing and returns null', async () => {
		// The token consumed successfully (it was in-domain at issue), but the email
		// is no longer in AUTHOR_EMAIL_DOMAIN (the operator narrowed it since). The
		// consumed token is discarded onto the neutral null path.
		mocks.consumeAuthorVerificationToken.mockResolvedValue('author@example.com');
		mocks.isAuthorEmailInDomain.mockReturnValue(false);

		const result = await completeAuthorSignIn('raw');

		expect(result).toBeNull();
		expect(mocks.isAuthorEmailInDomain).toHaveBeenCalledWith('author@example.com');
		expect(mocks.ensureAuthor).not.toHaveBeenCalled();
		expect(mocks.createAuthorSession).not.toHaveBeenCalled();
	});
});
