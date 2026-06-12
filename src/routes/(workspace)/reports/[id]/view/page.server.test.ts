import { describe, expect, it, vi } from 'vitest';
import { getReport } from '$lib/server/documents/reports';
import { AppError } from '$lib/server/problem';
import { fullDocument } from '$lib/schema/examples/full';
import { validateDocument } from '$lib/schema';
import { load } from './+page.server';

vi.mock('$lib/server/documents/reports', () => ({ getReport: vi.fn() }));

const getReportMock = vi.mocked(getReport);

function loadEvent(id: string) {
	return { params: { id } } as unknown as Parameters<typeof load>[0];
}

describe('reader view load', () => {
	it('returns the validated document and status', async () => {
		const result = validateDocument(fullDocument);
		if (!result.ok) throw new Error('fixture invalid');
		getReportMock.mockResolvedValueOnce({
			id: 'r1',
			title: result.document.title,
			schemaVersion: result.document.version,
			document: result.document,
			status: 'draft',
			createdAt: new Date(),
			updatedAt: new Date()
		});
		const data = await load(loadEvent('r1'));
		// load() returns the data object on the happy path (it only throws via
		// error() on the AppError branch, exercised separately below).
		expect(data?.document.title).toBe('Quarterly Security Report');
		expect(data?.status).toBe('draft');
	});

	it('maps an AppError to a SvelteKit error with its status', async () => {
		getReportMock.mockRejectedValueOnce(
			new AppError({ status: 404, title: 'Report not found', type: '/problems/report-not-found' })
		);
		await expect(load(loadEvent('missing'))).rejects.toMatchObject({ status: 404 });
	});
});
