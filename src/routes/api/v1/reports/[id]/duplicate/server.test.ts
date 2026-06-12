import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/documents/reports', () => ({ duplicateReport: vi.fn() }));

import { duplicateReport, type Report } from '$lib/server/documents/reports';
import { AppError } from '$lib/server/problem';
import { POST } from './+server';

const duplicateMock = vi.mocked(duplicateReport);

const ID = '01970000-0000-7000-8000-000000000001';
const NEW_ID = '01970000-0000-7000-8000-000000000002';
const DUPLICATE = { id: NEW_ID, title: 'Q2', status: 'draft' } as Report;

function event(): Parameters<typeof POST>[0] {
	return {
		params: { id: ID },
		request: new Request(`http://localhost/api/v1/reports/${ID}/duplicate`, { method: 'POST' })
	} as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('POST /api/v1/reports/:id/duplicate', () => {
	it('duplicates via duplicateReport and returns the new draft (201)', async () => {
		duplicateMock.mockResolvedValue(DUPLICATE);

		const response = await POST(event());

		expect(response.status).toBe(201);
		const body = (await response.json()) as { id: string; status: string };
		expect(body.id).toBe(NEW_ID);
		expect(body.status).toBe('draft');
		expect(duplicateMock).toHaveBeenCalledExactlyOnceWith(ID);
	});

	it('surfaces the service 404 as problem+json on an unknown id (thin adapter)', async () => {
		duplicateMock.mockRejectedValue(
			new AppError({
				status: 404,
				title: 'Report not found',
				type: '/problems/report-not-found'
			})
		);

		const response = await POST(event());

		expect(response.status).toBe(404);
		expect(response.headers.get('content-type')).toBe('application/problem+json');
		expect(((await response.json()) as { type: string }).type).toBe('/problems/report-not-found');
	});
});
