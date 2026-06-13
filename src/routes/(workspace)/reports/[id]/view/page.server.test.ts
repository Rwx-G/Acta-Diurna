import { describe, expect, it, vi } from 'vitest';
import { getReport } from '$lib/server/documents/reports';
import { AppError } from '$lib/server/problem';
import { fullDocument } from '$lib/schema/examples/full';
import { validateDocument } from '$lib/schema';
import { load } from './+page.server';

vi.mock('$lib/server/documents/reports', () => ({ getReport: vi.fn() }));
vi.mock('$lib/server/authors', () => ({
	resolveAuthorScope: () => Promise.resolve({ authorId: '01970000-0000-7000-8000-0000000000aa' })
}));

const getReportMock = vi.mocked(getReport);

function loadEvent(id: string) {
	return { params: { id } } as unknown as Parameters<typeof load>[0];
}

function reportWith(document: unknown, status: 'draft' | 'published') {
	return {
		id: 'r1',
		title: 'X',
		schemaVersion: 1,
		document,
		publishedDocument: null,
		publishedAt: null,
		status,
		createdAt: new Date(),
		updatedAt: new Date()
	} as Awaited<ReturnType<typeof getReport>>;
}

describe('reader view load', () => {
	it('returns the validated draft document and status with no render error', async () => {
		const result = validateDocument(fullDocument);
		if (!result.ok) throw new Error('fixture invalid');
		getReportMock.mockResolvedValueOnce(reportWith(result.document, 'draft'));

		const data = await load(loadEvent('r1'));

		expect(data?.document?.title).toBe('Quarterly Security Report');
		expect(data?.status).toBe('draft');
		expect(data?.renderError).toBeNull();
	});

	it('returns a neutral renderError for an unsupported stored version (FR7)', async () => {
		// A stored document at an unsupported version: no migration path exists, so
		// the load returns the version error to render as a neutral state.
		getReportMock.mockResolvedValueOnce(
			reportWith({ version: 0, title: 'Legacy', sections: [] }, 'published')
		);

		const data = await load(loadEvent('r1'));

		expect(data?.document).toBeNull();
		expect(data?.renderError?.[0].path).toBe('version');
		expect(data?.renderError?.[0].hint).toBe('Supported document schema versions: 1.');
	});

	it('maps an AppError to a SvelteKit error with its status', async () => {
		getReportMock.mockRejectedValueOnce(
			new AppError({ status: 404, title: 'Report not found', type: '/problems/report-not-found' })
		);
		await expect(load(loadEvent('missing'))).rejects.toMatchObject({ status: 404 });
	});
});
