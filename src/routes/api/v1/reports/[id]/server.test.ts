import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/documents/reports', () => ({
	getReport: vi.fn(),
	updateReportDocument: vi.fn(),
	updateReportTitle: vi.fn(),
	deleteDraft: vi.fn()
}));

import {
	deleteDraft,
	getReport,
	updateReportDocument,
	updateReportTitle,
	type Report
} from '$lib/server/documents/reports';
import { AppError } from '$lib/server/problem';
import { DELETE, GET, PATCH } from './+server';

const getReportMock = vi.mocked(getReport);
const updateDocumentMock = vi.mocked(updateReportDocument);
const updateTitleMock = vi.mocked(updateReportTitle);
const deleteDraftMock = vi.mocked(deleteDraft);

const ID = '01970000-0000-7000-8000-000000000001';
const REPORT = { id: ID, title: 'Q2', status: 'draft' } as Report;

const TEST_SCOPE = { authorId: '01970000-0000-7000-8000-0000000000aa' };
const LOCALS = { apiIdentity: { tokenId: 'tok', ownerId: TEST_SCOPE.authorId } };

function patch(body: unknown): Parameters<typeof PATCH>[0] {
	return {
		params: { id: ID },
		locals: LOCALS,
		request: new Request(`http://localhost/api/v1/reports/${ID}`, {
			method: 'PATCH',
			body: JSON.stringify(body)
		})
	} as unknown as Parameters<typeof PATCH>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('GET /api/v1/reports/:id', () => {
	it('returns the report from getReport (200)', async () => {
		getReportMock.mockResolvedValue(REPORT);

		const response = await GET({ params: { id: ID }, locals: LOCALS } as unknown as Parameters<
			typeof GET
		>[0]);

		expect(response.status).toBe(200);
		expect((await response.json()).id).toBe(ID);
		expect(getReportMock).toHaveBeenCalledExactlyOnceWith(ID, TEST_SCOPE);
	});

	it('surfaces the service 404 as problem+json (thin adapter)', async () => {
		getReportMock.mockRejectedValue(new AppError({ status: 404, title: 'Report not found' }));

		const response = await GET({ params: { id: ID }, locals: LOCALS } as unknown as Parameters<
			typeof GET
		>[0]);

		expect(response.status).toBe(404);
		expect(response.headers.get('content-type')).toBe('application/problem+json');
	});
});

describe('PATCH /api/v1/reports/:id', () => {
	it('routes a document update to updateReportDocument', async () => {
		updateDocumentMock.mockResolvedValue(REPORT);
		const document = { version: 1, title: 'X', sections: [] };

		const response = await PATCH(patch({ document }));

		expect(response.status).toBe(200);
		expect(updateDocumentMock).toHaveBeenCalledExactlyOnceWith(ID, document, TEST_SCOPE, undefined);
		expect(updateTitleMock).not.toHaveBeenCalled();
	});

	it('routes a title update to updateReportTitle', async () => {
		updateTitleMock.mockResolvedValue(REPORT);

		await PATCH(patch({ title: 'Renamed' }));

		expect(updateTitleMock).toHaveBeenCalledExactlyOnceWith(ID, 'Renamed', TEST_SCOPE);
		expect(updateDocumentMock).not.toHaveBeenCalled();
	});

	it('passes expectedUpdatedAt to the document service for optimistic concurrency', async () => {
		updateDocumentMock.mockResolvedValue(REPORT);
		const iso = '2026-06-12T10:00:00.000Z';

		await PATCH(patch({ document: { version: 1 }, expectedUpdatedAt: iso }));

		const call = updateDocumentMock.mock.calls[0];
		expect(call[3]).toBeInstanceOf(Date);
		expect((call[3] as Date).toISOString()).toBe(iso);
	});

	it('surfaces the service 409 on a stale expectedUpdatedAt (thin adapter)', async () => {
		updateDocumentMock.mockRejectedValue(
			new AppError({
				status: 409,
				title: 'Report changed concurrently',
				type: '/problems/report-conflict'
			})
		);

		const response = await PATCH(
			patch({ document: { version: 1 }, expectedUpdatedAt: '2026-06-12T10:00:00.000Z' })
		);

		expect(response.status).toBe(409);
		expect(((await response.json()) as { type: string }).type).toBe('/problems/report-conflict');
	});

	it('rejects an empty update (no title, no document) with a 400', async () => {
		const response = await PATCH(patch({}));
		expect(response.status).toBe(400);
		expect(updateDocumentMock).not.toHaveBeenCalled();
		expect(updateTitleMock).not.toHaveBeenCalled();
	});

	it('rejects a malformed expectedUpdatedAt with a 400', async () => {
		const response = await PATCH(patch({ title: 'X', expectedUpdatedAt: 'not-a-date' }));
		expect(response.status).toBe(400);
	});

	it('writes both in a single guarded document update when title and document are present', async () => {
		updateDocumentMock.mockResolvedValue({ ...REPORT, title: 'Final' });

		const response = await PATCH(
			patch({ document: { version: 1, title: 'From doc', sections: [] }, title: 'Final' })
		);

		expect(updateDocumentMock).toHaveBeenCalledExactlyOnceWith(
			ID,
			{ version: 1, title: 'Final', sections: [] },
			TEST_SCOPE,
			undefined
		);
		expect(updateTitleMock).not.toHaveBeenCalled();
		expect((await response.json()).title).toBe('Final');
	});

	it('lets the explicit title win over the document title when both differ', async () => {
		updateDocumentMock.mockResolvedValue(REPORT);

		await PATCH(patch({ document: { version: 1, title: 'Ignored' }, title: 'Wins' }));

		const call = updateDocumentMock.mock.calls[0];
		expect((call[1] as { title: string }).title).toBe('Wins');
	});

	it('guards the combined update atomically: a stale token 409s and writes nothing', async () => {
		updateDocumentMock.mockRejectedValue(
			new AppError({
				status: 409,
				title: 'Report changed concurrently',
				type: '/problems/report-conflict'
			})
		);

		const response = await PATCH(
			patch({
				document: { version: 1, title: 'D', sections: [] },
				title: 'Final',
				expectedUpdatedAt: '2026-06-12T10:00:00.000Z'
			})
		);

		expect(response.status).toBe(409);
		expect(((await response.json()) as { type: string }).type).toBe('/problems/report-conflict');
		expect(updateDocumentMock).toHaveBeenCalledOnce();
		const call = updateDocumentMock.mock.calls[0];
		expect(call[3]).toBeInstanceOf(Date);
		expect(updateTitleMock).not.toHaveBeenCalled();
	});
});

describe('DELETE /api/v1/reports/:id', () => {
	it('deletes a draft and returns 204', async () => {
		deleteDraftMock.mockResolvedValue();

		const response = await DELETE({ params: { id: ID }, locals: LOCALS } as unknown as Parameters<
			typeof DELETE
		>[0]);

		expect(response.status).toBe(204);
		expect(deleteDraftMock).toHaveBeenCalledExactlyOnceWith(ID, TEST_SCOPE);
	});

	it('surfaces the service 409 on a published report (thin adapter)', async () => {
		deleteDraftMock.mockRejectedValue(
			new AppError({
				status: 409,
				title: 'Report is published',
				type: '/problems/report-published'
			})
		);

		const response = await DELETE({
			params: { id: ID },
			locals: LOCALS
		} as unknown as Parameters<typeof DELETE>[0]);

		expect(response.status).toBe(409);
		expect(response.headers.get('content-type')).toBe('application/problem+json');
	});
});
