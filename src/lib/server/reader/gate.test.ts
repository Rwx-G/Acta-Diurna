import { beforeEach, describe, expect, it, vi } from 'vitest';

// Gate orchestration: assert the request/complete sequencing and the
// enumeration-safety posture (request always issues+sends; complete records
// identity + access + session only on a successful consume). All collaborators
// are mocked so this is a pure orchestration test.

const mocks = vi.hoisted(() => ({
	issueVerificationToken: vi.fn(),
	consumeVerificationToken: vi.fn(),
	findOrCreateIdentity: vi.fn(),
	recordAccess: vi.fn(),
	createReaderSession: vi.fn(),
	sendMail: vi.fn(),
	magicLinkEmail: vi.fn()
}));

vi.mock('./verification', () => ({
	issueVerificationToken: mocks.issueVerificationToken,
	consumeVerificationToken: mocks.consumeVerificationToken
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

import { completeVerification, requestVerification } from './gate';

beforeEach(() => {
	for (const m of Object.values(mocks)) m.mockReset();
	mocks.issueVerificationToken.mockResolvedValue({ token: 'raw-token', expiresAt: new Date() });
	mocks.magicLinkEmail.mockReturnValue({ to: 'x', subject: 's', text: 't' });
	mocks.sendMail.mockResolvedValue({ messageId: 'id' });
});

describe('requestVerification (enumeration-safety)', () => {
	it('issues a token and sends the magic link for any email', async () => {
		await requestVerification('share-1', 'reader@example.com', (t) => `https://x/verify?t=${t}`);

		expect(mocks.issueVerificationToken).toHaveBeenCalledWith('share-1', 'reader@example.com');
		expect(mocks.magicLinkEmail).toHaveBeenCalledWith(
			'reader@example.com',
			'https://x/verify?t=raw-token'
		);
		expect(mocks.sendMail).toHaveBeenCalledOnce();
	});

	it('does the same work for a different email (no branch on the address)', async () => {
		await requestVerification('share-1', 'someone-else@example.com', (t) => `https://x/v?t=${t}`);

		expect(mocks.issueVerificationToken).toHaveBeenCalledWith(
			'share-1',
			'someone-else@example.com'
		);
		expect(mocks.sendMail).toHaveBeenCalledOnce();
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
