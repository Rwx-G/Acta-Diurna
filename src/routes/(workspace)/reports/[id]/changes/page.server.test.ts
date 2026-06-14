import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getReport, getSeriesDiffView } from '$lib/server/documents/reports';
import { AppError } from '$lib/server/problem';
import type { SeriesDiff } from '$lib/schema';
import { load } from './+page.server';

vi.mock('$lib/server/documents/reports', () => ({
	getReport: vi.fn(),
	getSeriesDiffView: vi.fn()
}));
vi.mock('$lib/server/authors', () => ({
	resolveAuthorScope: () => Promise.resolve({ authorId: '01970000-0000-7000-8000-0000000000aa' })
}));

const getReportMock = vi.mocked(getReport);
const getSeriesDiffViewMock = vi.mocked(getSeriesDiffView);
const TEST_SCOPE = { authorId: '01970000-0000-7000-8000-0000000000aa' };

// The SvelteKit `load` signature widens the return to `void | PageData`, which
// erases the discriminated-union `state` field; we read it back through this alias.
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

function publishedReport(): Awaited<ReturnType<typeof getReport>> {
	return {
		id: 'r1',
		title: 'Weekly Status',
		schemaVersion: 1,
		document: { version: 1, title: 'draft', sections: [] },
		publishedDocument: { version: 1, title: 'Weekly Status', sections: [] },
		publishedAt: new Date('2026-06-14T09:00:00.000Z'),
		status: 'published',
		seriesId: '01970000-0000-7000-8000-0000000000c1',
		predecessorId: '01970000-0000-7000-8000-0000000000d1',
		issueLabel: '2026-W24',
		createdAt: new Date(),
		updatedAt: new Date()
	} as Awaited<ReturnType<typeof getReport>>;
}

function draftReport(): Awaited<ReturnType<typeof getReport>> {
	return { ...publishedReport(), status: 'draft', publishedDocument: null, publishedAt: null };
}

const COMPUTED_DIFF: SeriesDiff = {
	kind: 'diff',
	sections: [
		{
			id: 'summary',
			title: 'Summary',
			change: 'kept',
			blocks: [
				{ id: 'kpi-1', type: 'kpi', change: 'kept', dataChanged: true, contentChanged: false }
			]
		}
	]
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe('what-changed view load', () => {
	it('serves the computed diff and the predecessor baseline for a published issue', async () => {
		getReportMock.mockResolvedValueOnce(publishedReport());
		getSeriesDiffViewMock.mockResolvedValueOnce({
			diff: COMPUTED_DIFF,
			baseline: {
				title: 'Previous issue',
				issueLabel: '2026-W23',
				publishedAt: new Date('2026-06-07T09:00:00.000Z')
			}
		});

		const data = await runLoad('r1');

		expect(data.state).toBe('ready');
		if (data.state === 'ready') {
			expect(data.title).toBe('Weekly Status');
			expect(data.diff.kind).toBe('diff');
			expect(data.baseline?.issueLabel).toBe('2026-W23');
		}
	});

	it('is owner-scoped: both reads run with the resolved author scope', async () => {
		getReportMock.mockResolvedValueOnce(publishedReport());
		getSeriesDiffViewMock.mockResolvedValueOnce({ diff: COMPUTED_DIFF, baseline: null });

		await runLoad('r1');

		expect(getReportMock).toHaveBeenCalledWith('r1', TEST_SCOPE);
		expect(getSeriesDiffViewMock).toHaveBeenCalledWith('r1', TEST_SCOPE);
	});

	it('a non-owner or unknown id is the same neutral 404 (tenancy seam)', async () => {
		getReportMock.mockRejectedValueOnce(
			new AppError({ status: 404, title: 'Report not found', type: '/problems/report-not-found' })
		);

		await expect(runLoad('foreign-or-missing')).rejects.toMatchObject({ status: 404 });
	});

	it('a draft issue returns the publish-first state without diffing', async () => {
		getReportMock.mockResolvedValueOnce(draftReport());

		const data = await runLoad('r1');

		expect(data.state).toBe('not-published');
		if (data.state === 'not-published') {
			expect(data.title).toBe('Weekly Status');
		}
		expect(getSeriesDiffViewMock).not.toHaveBeenCalled();
	});

	it('surfaces the first-issue neutral state', async () => {
		getReportMock.mockResolvedValueOnce(publishedReport());
		getSeriesDiffViewMock.mockResolvedValueOnce({
			diff: { kind: 'no-predecessor', reason: 'first-issue' },
			baseline: null
		});

		const data = await runLoad('r1');

		expect(data.state).toBe('ready');
		if (data.state === 'ready') {
			expect(data.diff).toEqual({ kind: 'no-predecessor', reason: 'first-issue' });
			expect(data.baseline).toBeNull();
		}
	});

	it('surfaces the predecessor-unpublished neutral state', async () => {
		getReportMock.mockResolvedValueOnce(publishedReport());
		getSeriesDiffViewMock.mockResolvedValueOnce({
			diff: { kind: 'no-predecessor', reason: 'predecessor-unpublished' },
			baseline: null
		});

		const data = await runLoad('r1');

		expect(data.state).toBe('ready');
		if (data.state === 'ready') {
			expect(data.diff).toMatchObject({
				kind: 'no-predecessor',
				reason: 'predecessor-unpublished'
			});
		}
	});

	it('surfaces the substantial-drift neutral state', async () => {
		getReportMock.mockResolvedValueOnce(publishedReport());
		getSeriesDiffViewMock.mockResolvedValueOnce({
			diff: { kind: 'substantial-drift', overlap: 0.05 },
			baseline: null
		});

		const data = await runLoad('r1');

		expect(data.state).toBe('ready');
		if (data.state === 'ready') {
			expect(data.diff.kind).toBe('substantial-drift');
		}
	});
});
