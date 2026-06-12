import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createShare, listShares, shareUrl } from '$lib/server/sharing';
import { getReport, type Report } from '$lib/server/documents/reports';
import { AppError } from '$lib/server/problem';
import { actions, load } from './+page.server';

vi.mock('$lib/server/sharing', () => ({
	createShare: vi.fn(),
	listShares: vi.fn(),
	shareUrl: (origin: string, token: string) => `${origin}/r/${token}`
}));
vi.mock('$lib/server/documents/reports', () => ({ getReport: vi.fn() }));

const createShareMock = vi.mocked(createShare);
const listSharesMock = vi.mocked(listShares);
const getReportMock = vi.mocked(getReport);

const REPORT_ID = '0197b300-0000-7000-8000-000000000aaa';

function publishedReport(): Report {
	return { id: REPORT_ID, title: 'A report', status: 'published' } as Report;
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
		request: formRequest(fields),
		url: new URL('http://localhost/reports/x/share')
	} as unknown as Parameters<(typeof actions)['create-share']>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('load', () => {
	it('returns the report status and its shares', async () => {
		getReportMock.mockResolvedValue(publishedReport());
		listSharesMock.mockResolvedValue([]);

		const result = await load({ params: { id: REPORT_ID } } as Parameters<typeof load>[0]);

		expect(result).toBeDefined();
		expect(result!.report.status).toBe('published');
		expect(result!.shares).toEqual([]);
		expect(listSharesMock).toHaveBeenCalledWith(REPORT_ID);
	});

	it('does not leak a raw token: load never touches the token service', async () => {
		getReportMock.mockResolvedValue(publishedReport());
		listSharesMock.mockResolvedValue([]);

		const result = await load({ params: { id: REPORT_ID } } as Parameters<typeof load>[0]);

		expect(JSON.stringify(result)).not.toContain('token');
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
				status: 'active'
			}
		});

		const result = await actions['create-share'](createEvent({ mode: 'restricted' }));

		expect(createShareMock).toHaveBeenCalledWith(REPORT_ID, {
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
				status: 'active'
			}
		});

		await actions['create-share'](
			createEvent({ mode: 'restricted', expiresAt: '2026-12-31T23:59' })
		);

		expect(createShareMock).toHaveBeenCalledWith(REPORT_ID, {
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
				status: 'active'
			}
		});

		await actions['create-share'](createEvent({ mode: 'open' }));

		expect(createShareMock).toHaveBeenCalledWith(REPORT_ID, { mode: 'open', expiresAt: null });
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
});

describe('shareUrl wiring', () => {
	it('is the /r/[token] reader route shape', () => {
		expect(shareUrl('https://x.example', 'abc')).toBe('https://x.example/r/abc');
	});
});
