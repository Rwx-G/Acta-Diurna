import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createShare,
	listRecipientsForShares,
	listShares,
	revokeShare,
	setShareMode,
	setShareRecipients,
	shareUrl
} from '$lib/server/sharing';
import { getReport, type Report } from '$lib/server/documents/reports';
import { AppError } from '$lib/server/problem';
import { actions, load } from './+page.server';

vi.mock('$lib/server/sharing', () => ({
	createShare: vi.fn(),
	listShares: vi.fn(),
	setShareMode: vi.fn(),
	revokeShare: vi.fn(),
	listRecipientsForShares: vi.fn(),
	setShareRecipients: vi.fn(),
	shareUrl: (origin: string, token: string) => `${origin}/r/${token}`
}));
vi.mock('$lib/server/documents/reports', () => ({ getReport: vi.fn() }));
vi.mock('$lib/server/authors', () => ({
	resolveAuthorScope: () => Promise.resolve({ authorId: '01970000-0000-7000-8000-0000000000aa' })
}));

// Mode-aware sharing UI (story 8.4): default the suite to MULTI mode (the
// restricted/open + recipient controls path the existing tests assert); the
// single-mode describe flips it to assert the consultation-token behavior.
const modeState = vi.hoisted(() => ({ multi: true }));
vi.mock('$lib/server/mode', () => ({
	operatingMode: () => (modeState.multi ? 'multi' : 'single'),
	isMultiAuthor: () => modeState.multi
}));

const TEST_SCOPE = { authorId: '01970000-0000-7000-8000-0000000000aa' };
// Use the real email helpers so recipient parsing/normalization is exercised.
vi.mock('$lib/server/reader', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/reader')>('$lib/server/reader');
	return { normalizeEmail: actual.normalizeEmail, isPlausibleEmail: actual.isPlausibleEmail };
});

const createShareMock = vi.mocked(createShare);
const listSharesMock = vi.mocked(listShares);
const setShareModeMock = vi.mocked(setShareMode);
const revokeShareMock = vi.mocked(revokeShare);
const listRecipientsForSharesMock = vi.mocked(listRecipientsForShares);
const setShareRecipientsMock = vi.mocked(setShareRecipients);
const getReportMock = vi.mocked(getReport);

const REPORT_ID = '0197b300-0000-7000-8000-000000000aaa';

function publishedReport(): Report {
	return { id: REPORT_ID, title: 'A report', status: 'published' } as Report;
}

function loadEvent(): Parameters<typeof load>[0] {
	return {
		params: { id: REPORT_ID },
		url: new URL('http://localhost/reports/x/share'),
		locals: { authorSession: null }
	} as Parameters<typeof load>[0];
}

function formRequest(fields: Record<string, string>): Request {
	const body = new URLSearchParams(fields);
	return new Request('http://localhost/reports/x/share?/create-share', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: body.toString()
	});
}

function createEvent(
	fields: Record<string, string>
): Parameters<(typeof actions)['create-share']>[0] {
	return {
		params: { id: REPORT_ID },
		locals: { authorSession: null },
		request: formRequest(fields),
		url: new URL('http://localhost/reports/x/share')
	} as unknown as Parameters<(typeof actions)['create-share']>[0];
}

function actionEvent(fields: Record<string, string>): never {
	return {
		params: { id: REPORT_ID },
		locals: { authorSession: null },
		request: formRequest(fields),
		url: new URL('http://localhost/reports/x/share')
	} as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	modeState.multi = true;
	listRecipientsForSharesMock.mockResolvedValue(new Map());
	setShareRecipientsMock.mockResolvedValue(undefined);
	setShareModeMock.mockResolvedValue(1);
	revokeShareMock.mockResolvedValue(undefined);
});

describe('load', () => {
	it('returns the report status and its shares', async () => {
		getReportMock.mockResolvedValue(publishedReport());
		listSharesMock.mockResolvedValue([]);

		const result = await load(loadEvent());

		expect(result).toBeDefined();
		expect(result!.report.status).toBe('published');
		expect(result!.shares).toEqual([]);
		expect(listSharesMock).toHaveBeenCalledWith(REPORT_ID, TEST_SCOPE);
	});

	it('builds each share link from its recoverable token, null when unrecoverable', async () => {
		getReportMock.mockResolvedValue(publishedReport());
		listSharesMock.mockResolvedValue([
			{
				id: 's-live',
				mode: 'open',
				expiresAt: null,
				createdAt: new Date(),
				revokedAt: null,
				status: 'active',
				recoverableToken: 'RECOVERED'
			},
			{
				id: 's-old',
				mode: 'open',
				expiresAt: null,
				createdAt: new Date(),
				revokedAt: null,
				status: 'active',
				recoverableToken: null
			}
		]);

		const result = await load(loadEvent());

		expect(result!.shares[0].link).toBe('http://localhost/r/RECOVERED');
		expect(result!.shares[1].link).toBeNull();
	});

	it('surfaces multi=true in multi mode and reads each share allow-list', async () => {
		getReportMock.mockResolvedValue(publishedReport());
		listSharesMock.mockResolvedValue([]);

		const result = await load(loadEvent());

		expect(result!.multi).toBe(true);
		expect(listRecipientsForSharesMock).toHaveBeenCalled();
	});

	it('single mode: surfaces multi=false and skips the recipient read (no allow-lists, story 8.4)', async () => {
		modeState.multi = false;
		getReportMock.mockResolvedValue(publishedReport());
		listSharesMock.mockResolvedValue([
			{
				id: 's1',
				mode: 'open',
				expiresAt: null,
				createdAt: new Date(),
				revokedAt: null,
				status: 'active',
				recoverableToken: null
			}
		]);

		const result = await load(loadEvent());

		expect(result!.multi).toBe(false);
		// No email, so no recipient lists exist - the batched read is skipped entirely.
		expect(listRecipientsForSharesMock).not.toHaveBeenCalled();
		expect(result!.shares[0].recipients).toEqual([]);
	});
});

describe('create-share action', () => {
	it('creates a share with no expiry and returns the raw URL once', async () => {
		createShareMock.mockResolvedValue({
			token: 'RAWTOKEN',
			share: {
				id: 's1',
				mode: 'restricted',
				expiresAt: null,
				createdAt: new Date(),
				revokedAt: null,
				status: 'active',
				recoverableToken: null
			}
		});

		const result = await actions['create-share'](createEvent({ mode: 'restricted' }));

		expect(createShareMock).toHaveBeenCalledWith(REPORT_ID, TEST_SCOPE, {
			mode: 'restricted',
			expiresAt: null
		});
		expect(result).toMatchObject({
			created: { url: 'http://localhost/r/RAWTOKEN' }
		});
	});

	it('parses a datetime-local expiry as UTC', async () => {
		createShareMock.mockResolvedValue({
			token: 't',
			share: {
				id: 's2',
				mode: 'restricted',
				expiresAt: new Date('2026-12-31T23:59:00Z'),
				createdAt: new Date(),
				revokedAt: null,
				status: 'active',
				recoverableToken: null
			}
		});

		await actions['create-share'](
			createEvent({ mode: 'restricted', expiresAt: '2026-12-31T23:59' })
		);

		expect(createShareMock).toHaveBeenCalledWith(REPORT_ID, TEST_SCOPE, {
			mode: 'restricted',
			expiresAt: new Date('2026-12-31T23:59:00Z')
		});
	});

	it('passes open mode through', async () => {
		createShareMock.mockResolvedValue({
			token: 't',
			share: {
				id: 's3',
				mode: 'open',
				expiresAt: null,
				createdAt: new Date(),
				revokedAt: null,
				status: 'active',
				recoverableToken: null
			}
		});

		await actions['create-share'](createEvent({ mode: 'open' }));

		expect(createShareMock).toHaveBeenCalledWith(REPORT_ID, TEST_SCOPE, {
			mode: 'open',
			expiresAt: null
		});
	});

	it('translates a draft refusal AppError into a fail with its message', async () => {
		createShareMock.mockRejectedValue(
			new AppError({
				status: 409,
				title: 'Report is not published',
				type: '/problems/report-not-published',
				detail: 'Only a published report can be shared.'
			})
		);

		const result = await actions['create-share'](createEvent({ mode: 'restricted' }));

		expect(result).toMatchObject({
			status: 409,
			data: { message: 'Only a published report can be shared.' }
		});
	});

	it('rejects a malformed expiry with a 400 fail', async () => {
		const result = await actions['create-share'](
			createEvent({ mode: 'restricted', expiresAt: 'not-a-date' })
		);

		expect(result).toMatchObject({ status: 400 });
		expect(createShareMock).not.toHaveBeenCalled();
	});

	it('single mode: forces open and carries no recipients, whatever the form sent (story 8.4)', async () => {
		// The mode/recipient inputs are hidden in single-mode UI, but a crafted POST
		// could still send them. The action forces `open` and drops recipients, so a
		// restricted request never reaches the service and no allow-list is set.
		modeState.multi = false;
		createShareMock.mockResolvedValue({
			token: 't',
			share: {
				id: 's-single',
				mode: 'open',
				expiresAt: null,
				createdAt: new Date(),
				revokedAt: null,
				status: 'active',
				recoverableToken: null
			}
		});

		await actions['create-share'](
			createEvent({ mode: 'restricted', recipients: 'sneaky@example.com' })
		);

		expect(createShareMock).toHaveBeenCalledWith(REPORT_ID, TEST_SCOPE, {
			mode: 'open',
			expiresAt: null
		});
		expect(setShareRecipientsMock).not.toHaveBeenCalled();
	});
});

describe('load with recipients', () => {
	it('attaches each share recipient allow-list', async () => {
		getReportMock.mockResolvedValue(publishedReport());
		listSharesMock.mockResolvedValue([
			{
				id: 's1',
				mode: 'restricted',
				expiresAt: null,
				createdAt: new Date(),
				revokedAt: null,
				status: 'active',
				recoverableToken: null
			}
		]);
		listRecipientsForSharesMock.mockResolvedValue(
			new Map([['s1', ['a@example.com', 'b@example.com']]])
		);

		const result = await load({
			params: { id: REPORT_ID },
			locals: { authorSession: null }
		} as Parameters<typeof load>[0]);

		expect(listRecipientsForSharesMock).toHaveBeenCalledWith(['s1']);
		expect(result!.shares[0].recipients).toEqual(['a@example.com', 'b@example.com']);
	});
});

describe('create-share with an initial recipient list', () => {
	it('sets the list for a restricted share', async () => {
		createShareMock.mockResolvedValue({
			token: 't',
			share: {
				id: 's9',
				mode: 'restricted',
				expiresAt: null,
				createdAt: new Date(),
				revokedAt: null,
				status: 'active',
				recoverableToken: null
			}
		});

		await actions['create-share'](
			createEvent({ mode: 'restricted', recipients: 'On@List.com, other@x.org' })
		);

		expect(setShareRecipientsMock).toHaveBeenCalledWith(
			's9',
			['on@list.com', 'other@x.org'],
			TEST_SCOPE
		);
	});

	it('does not set a list for an open share', async () => {
		createShareMock.mockResolvedValue({
			token: 't',
			share: {
				id: 's10',
				mode: 'open',
				expiresAt: null,
				createdAt: new Date(),
				revokedAt: null,
				status: 'active',
				recoverableToken: null
			}
		});

		await actions['create-share'](createEvent({ mode: 'open', recipients: 'a@example.com' }));

		expect(setShareRecipientsMock).not.toHaveBeenCalled();
	});
});

describe('set-mode action', () => {
	it('flips a share to open', async () => {
		const result = await actions['set-mode'](actionEvent({ shareId: 's1', mode: 'open' }));
		expect(setShareModeMock).toHaveBeenCalledWith('s1', 'open', TEST_SCOPE);
		expect(result).toMatchObject({ modeSet: { shareId: 's1', mode: 'open' } });
	});

	it('defaults an unknown mode value to restricted', async () => {
		await actions['set-mode'](actionEvent({ shareId: 's1', mode: 'garbage' }));
		expect(setShareModeMock).toHaveBeenCalledWith('s1', 'restricted', TEST_SCOPE);
	});

	it('404s when the share id is unknown', async () => {
		setShareModeMock.mockResolvedValue(0);
		const result = await actions['set-mode'](actionEvent({ shareId: 'gone', mode: 'open' }));
		expect(result).toMatchObject({ status: 404 });
	});

	it('400s when the share id is missing', async () => {
		const result = await actions['set-mode'](actionEvent({ mode: 'open' }));
		expect(result).toMatchObject({ status: 400 });
		expect(setShareModeMock).not.toHaveBeenCalled();
	});
});

describe('set-recipients action', () => {
	it('parses, normalizes and dedups the submitted list', async () => {
		const result = await actions['set-recipients'](
			actionEvent({ shareId: 's1', recipients: 'A@X.com\nb@x.com; A@X.com, not-an-email' })
		);

		expect(setShareRecipientsMock).toHaveBeenCalledWith('s1', ['a@x.com', 'b@x.com'], TEST_SCOPE);
		expect(result).toMatchObject({ recipientsSet: { shareId: 's1', count: 2 } });
	});

	it('an empty submission clears the list', async () => {
		const result = await actions['set-recipients'](actionEvent({ shareId: 's1', recipients: '' }));
		expect(setShareRecipientsMock).toHaveBeenCalledWith('s1', [], TEST_SCOPE);
		expect(result).toMatchObject({ recipientsSet: { shareId: 's1', count: 0 } });
	});

	it('400s when the share id is missing', async () => {
		const result = await actions['set-recipients'](actionEvent({ recipients: 'a@x.com' }));
		expect(result).toMatchObject({ status: 400 });
		expect(setShareRecipientsMock).not.toHaveBeenCalled();
	});

	it('404s (not 500) when setShareRecipients rejects an unknown shareId', async () => {
		setShareRecipientsMock.mockRejectedValue(
			new AppError({
				status: 404,
				title: 'Share not found',
				type: '/problems/share-not-found',
				detail: 'This share does not exist.'
			})
		);
		const result = await actions['set-recipients'](
			actionEvent({ shareId: 'gone', recipients: 'a@x.com' })
		);
		expect(result).toMatchObject({ status: 404, data: { message: 'This share does not exist.' } });
	});

	it('422s when setShareRecipients rejects an over-cap list', async () => {
		setShareRecipientsMock.mockRejectedValue(
			new AppError({
				status: 422,
				title: 'Too many recipients',
				type: '/problems/share-recipients-limit',
				detail: 'A share allow-list is limited to 500 recipients.'
			})
		);
		const result = await actions['set-recipients'](
			actionEvent({ shareId: 's1', recipients: 'a@x.com' })
		);
		expect(result).toMatchObject({ status: 422 });
	});
});

describe('revoke-share action', () => {
	it('revokes the share and returns its id', async () => {
		const result = await actions['revoke-share'](actionEvent({ shareId: 's1' }));
		expect(revokeShareMock).toHaveBeenCalledWith('s1', TEST_SCOPE);
		expect(result).toMatchObject({ revoked: { shareId: 's1' } });
	});

	it('400s when the share id is missing', async () => {
		const result = await actions['revoke-share'](actionEvent({}));
		expect(result).toMatchObject({ status: 400 });
		expect(revokeShareMock).not.toHaveBeenCalled();
	});

	it('is idempotent at the action layer: a second revoke still resolves cleanly', async () => {
		await actions['revoke-share'](actionEvent({ shareId: 's1' }));
		const result = await actions['revoke-share'](actionEvent({ shareId: 's1' }));
		expect(revokeShareMock).toHaveBeenCalledTimes(2);
		expect(result).toMatchObject({ revoked: { shareId: 's1' } });
	});
});

describe('shareUrl wiring', () => {
	it('is the /r/[token] reader route shape', () => {
		expect(shareUrl('https://x.example', 'abc')).toBe('https://x.example/r/abc');
	});
});
