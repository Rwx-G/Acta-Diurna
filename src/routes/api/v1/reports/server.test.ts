import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/documents/reports', () => ({
	createReport: vi.fn(),
	createReportWithDocument: vi.fn(),
	listReports: vi.fn()
}));

import {
	createReport,
	createReportWithDocument,
	listReports,
	type Report,
	type ReportSummary
} from '$lib/server/documents/reports';
import { DEFAULT_REPORT_TITLE } from '$lib/server/documents/defaults';
import { AppError } from '$lib/server/problem';
import { GET, POST } from './+server';

const createReportMock = vi.mocked(createReport);
const createWithDocumentMock = vi.mocked(createReportWithDocument);
const listReportsMock = vi.mocked(listReports);

const SUMMARY: ReportSummary = {
	id: '01970000-0000-7000-8000-000000000001',
	title: 'Q2 report',
	status: 'draft',
	updatedAt: new Date('2026-06-12T10:00:00.000Z')
};

const REPORT = { id: SUMMARY.id, title: 'Q2 report', status: 'draft' } as Report;

const TEST_SCOPE = { authorId: '01970000-0000-7000-8000-0000000000aa' };
const LOCALS = { apiIdentity: { tokenId: 'tok', ownerId: TEST_SCOPE.authorId } };

function postRequest(body: unknown): { request: Request; locals: typeof LOCALS } {
	return {
		locals: LOCALS,
		request: new Request('http://localhost/api/v1/reports', {
			method: 'POST',
			body: JSON.stringify(body)
		})
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('GET /api/v1/reports', () => {
	function getEvent(query = ''): Parameters<typeof GET>[0] {
		return {
			locals: LOCALS,
			url: new URL(`http://localhost/api/v1/reports${query}`)
		} as unknown as Parameters<typeof GET>[0];
	}

	it('returns the listReports projection in an { items, nextCursor } envelope', async () => {
		listReportsMock.mockResolvedValue({ items: [SUMMARY], nextCursor: null });

		const response = await GET(getEvent());

		expect(response.status).toBe(200);
		const body = (await response.json()) as { items: unknown[]; nextCursor: string | null };
		expect(Object.keys(body)).toEqual(['items', 'nextCursor']);
		expect(body.items).toHaveLength(1);
		expect((body.items[0] as ReportSummary).id).toBe(SUMMARY.id);
		expect(body.nextCursor).toBeNull();
		expect(listReportsMock).toHaveBeenCalledOnce();
	});

	it('surfaces the page cursor and threads ?cursor / ?limit through to the service', async () => {
		listReportsMock.mockResolvedValue({ items: [SUMMARY], nextCursor: 'page-2' });

		const response = await GET(getEvent('?cursor=page-1&limit=25'));
		const body = (await response.json()) as { nextCursor: string | null };

		expect(body.nextCursor).toBe('page-2');
		expect(listReportsMock).toHaveBeenCalledWith(TEST_SCOPE, { cursor: 'page-1', limit: 25 });
	});
});

describe('POST /api/v1/reports', () => {
	it('creates a blank draft with the default title when no body fields are given', async () => {
		createReportMock.mockResolvedValue(REPORT);

		const response = await POST(postRequest({}) as Parameters<typeof POST>[0]);

		expect(response.status).toBe(201);
		expect(createReportMock).toHaveBeenCalledExactlyOnceWith(DEFAULT_REPORT_TITLE, TEST_SCOPE);
		expect(createWithDocumentMock).not.toHaveBeenCalled();
	});

	it('uses a provided title for the blank starter', async () => {
		createReportMock.mockResolvedValue(REPORT);

		await POST(postRequest({ title: 'Custom' }) as Parameters<typeof POST>[0]);

		expect(createReportMock).toHaveBeenCalledExactlyOnceWith('Custom', TEST_SCOPE);
	});

	it('instantiates a provided document via createReportWithDocument', async () => {
		createWithDocumentMock.mockResolvedValue(REPORT);
		const document = { version: 1, title: 'X', sections: [] };

		const response = await POST(postRequest({ document }) as Parameters<typeof POST>[0]);

		expect(response.status).toBe(201);
		expect(createWithDocumentMock).toHaveBeenCalledExactlyOnceWith(document, TEST_SCOPE);
		expect(createReportMock).not.toHaveBeenCalled();
	});

	it('rejects a non-object body with a 400 problem+json (no service call)', async () => {
		const event = {
			locals: LOCALS,
			request: new Request('http://localhost/api/v1/reports', { method: 'POST', body: '[]' })
		};
		const response = await POST(event as Parameters<typeof POST>[0]);
		expect(response.status).toBe(400);
		expect(response.headers.get('content-type')).toBe('application/problem+json');
		expect(createReportMock).not.toHaveBeenCalled();
	});

	it('rejects a non-string title with a 400 problem+json', async () => {
		const response = await POST(postRequest({ title: 42 }) as Parameters<typeof POST>[0]);
		expect(response.status).toBe(400);
	});

	it('surfaces the service AppError as problem+json (thin adapter) on an invalid document', async () => {
		createWithDocumentMock.mockRejectedValue(
			new AppError({
				status: 422,
				title: 'Document validation failed',
				type: '/problems/document-validation',
				errors: [{ path: 'version', message: 'bad', hint: 'fix it' }]
			})
		);

		const response = await POST(postRequest({ document: {} }) as Parameters<typeof POST>[0]);

		expect(response.status).toBe(422);
		expect(response.headers.get('content-type')).toBe('application/problem+json');
		const body = (await response.json()) as { errors: unknown[] };
		expect(body.errors).toEqual([{ path: 'version', message: 'bad', hint: 'fix it' }]);
	});
});
