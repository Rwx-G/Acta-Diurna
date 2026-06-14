import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSeriesDiffView } from '$lib/server/documents/reports';
import { AppError } from '$lib/server/problem';
import type { SeriesDiff } from '$lib/schema';
import { load } from './+page.server';

vi.mock('$lib/server/documents/reports', () => ({
	getSeriesDiffView: vi.fn()
}));
vi.mock('$lib/server/authors', () => ({
	resolveAuthorScope: () => Promise.resolve({ authorId: '01970000-0000-7000-8000-0000000000aa' })
}));

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
		getSeriesDiffViewMock.mockResolvedValueOnce({
			state: 'ready',
			title: 'Weekly Status',
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

	it('is owner-scoped: the single read runs with the resolved author scope', async () => {
		getSeriesDiffViewMock.mockResolvedValueOnce({
			state: 'ready',
			title: 'Weekly Status',
			diff: COMPUTED_DIFF,
			baseline: null
		});

		await runLoad('r1');

		// The loader does NO read of its own: the view service is the only seam, and it
		// runs under the resolved scope (it ANDs the owner predicate on every read).
		expect(getSeriesDiffViewMock).toHaveBeenCalledTimes(1);
		expect(getSeriesDiffViewMock).toHaveBeenCalledWith('r1', TEST_SCOPE);
	});

	it('a non-owner or unknown id is the same neutral 404 (tenancy seam)', async () => {
		getSeriesDiffViewMock.mockRejectedValueOnce(
			new AppError({ status: 404, title: 'Report not found', type: '/problems/report-not-found' })
		);

		await expect(runLoad('foreign-or-missing')).rejects.toMatchObject({ status: 404 });
	});

	it('a draft issue returns the publish-first state from the same view read', async () => {
		getSeriesDiffViewMock.mockResolvedValueOnce({
			state: 'not-published',
			title: 'Weekly Status'
		});

		const data = await runLoad('r1');

		expect(data.state).toBe('not-published');
		if (data.state === 'not-published') {
			expect(data.title).toBe('Weekly Status');
		}
	});

	it('surfaces the first-issue neutral state', async () => {
		getSeriesDiffViewMock.mockResolvedValueOnce({
			state: 'ready',
			title: 'Weekly Status',
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
		getSeriesDiffViewMock.mockResolvedValueOnce({
			state: 'ready',
			title: 'Weekly Status',
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
		getSeriesDiffViewMock.mockResolvedValueOnce({
			state: 'ready',
			title: 'Weekly Status',
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
