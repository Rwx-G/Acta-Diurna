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
const TEST_SCOPE = { authorId: '01970000-0000-7000-8000-0000000000aa' };

// The SvelteKit `load` signature widens the return to `void | PageData`, which
// erases the discriminated-union `state` field. The loader's own return type is
// the precise shape, so we read it back through this alias to assert on `state`.
type LoadResult = Exclude<Awaited<ReturnType<typeof load>>, void>;

function runLoad(id: string): Promise<LoadResult> {
	return load(loadEvent(id)) as Promise<LoadResult>;
}

function loadEvent(id: string) {
	return {
		params: { id },
		locals: { authorSession: null }
	} as unknown as Parameters<typeof load>[0];
}

function reportWith(
	publishedDocument: unknown,
	status: 'draft' | 'published'
): Awaited<ReturnType<typeof getReport>> {
	return {
		id: 'r1',
		title: 'Quarterly Security Report',
		schemaVersion: 1,
		document: { version: 1, title: 'draft', sections: [] },
		publishedDocument,
		publishedAt: status === 'published' ? new Date() : null,
		status,
		seriesId: '01970000-0000-7000-8000-0000000000c1',
		predecessorId: null,
		issueLabel: null,
		createdAt: new Date(),
		updatedAt: new Date()
	} as Awaited<ReturnType<typeof getReport>>;
}

describe('presenter view load', () => {
	it('serves the published snapshot ready to present', async () => {
		const result = validateDocument(fullDocument);
		if (!result.ok) throw new Error('fixture invalid');
		getReportMock.mockResolvedValueOnce(reportWith(result.document, 'published'));

		const data = await runLoad('r1');

		expect(data.state).toBe('ready');
		if (data.state === 'ready') {
			expect(data.document?.title).toBe('Quarterly Security Report');
			expect(data.renderError).toBeNull();
		}
	});

	it('is owner-scoped: getReport runs with the resolved author scope', async () => {
		const result = validateDocument(fullDocument);
		if (!result.ok) throw new Error('fixture invalid');
		getReportMock.mockResolvedValueOnce(reportWith(result.document, 'published'));

		await load(loadEvent('r1'));

		expect(getReportMock).toHaveBeenCalledWith('r1', TEST_SCOPE);
	});

	it('a non-owner or unknown id is the same 404 (tenancy seam)', async () => {
		// getReport ANDs the owner predicate, so a foreign or unknown id both surface
		// the SAME not-found AppError; the loader maps it to a 404 with no oracle.
		getReportMock.mockRejectedValueOnce(
			new AppError({ status: 404, title: 'Report not found', type: '/problems/report-not-found' })
		);

		await expect(load(loadEvent('foreign-or-missing'))).rejects.toMatchObject({ status: 404 });
	});

	it('requires a published report: a draft returns the publish-first state', async () => {
		getReportMock.mockResolvedValueOnce(reportWith(null, 'draft'));

		const data = await runLoad('r1');

		expect(data.state).toBe('not-published');
		if (data.state === 'not-published') {
			expect(data.title).toBe('Quarterly Security Report');
		}
	});

	it('returns a neutral renderError for an unsupported snapshot version (FR7)', async () => {
		getReportMock.mockResolvedValueOnce(
			reportWith({ version: 0, title: 'Legacy', sections: [] }, 'published')
		);

		const data = await runLoad('r1');

		expect(data.state).toBe('ready');
		if (data.state === 'ready') {
			expect(data.document).toBeNull();
			expect(data.renderError?.[0].path).toBe('version');
		}
	});
});
