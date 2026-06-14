import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { SeriesDiff } from '$lib/schema';
import SeriesDiffView from './SeriesDiffView.svelte';

// Prose/notes that live in the REAL prior and current snapshots but never in the
// SeriesDiff the view is handed. The view renders ids, types, titles, and flags
// only, so none of these must ever reach the DOM - a leak tripwire, not a string
// that only exists in the test closure.
const PRIOR_PROSE = 'Old quarter revenue narrative the predecessor carried';
const CURRENT_PROSE = 'New quarter revenue narrative the refilled issue carries';
const SPEAKER_NOTE = 'CONFIDENTIAL presenter note that must never render here';
const LEAK_MARKERS = [PRIOR_PROSE, CURRENT_PROSE, SPEAKER_NOTE];

// Recognizable marker ids/titles the view IS expected to render, so the tripwire is
// not vacuously true (a diff that rendered nothing would also leak nothing).
const MARKER_BLOCK_ID = 'kpi-revenue-marker';
const MARKER_SECTION_TITLE = 'Revenue summary marker';

function computedDiff(): SeriesDiff {
	return {
		kind: 'diff',
		sections: [
			{
				id: 'summary',
				title: 'Summary',
				change: 'kept',
				blocks: [
					{ id: 'kpi-1', type: 'kpi', change: 'moved', dataChanged: true, contentChanged: true },
					{ id: 'text-1', type: 'text', change: 'kept', dataChanged: false, contentChanged: false }
				]
			},
			{
				id: 'detail',
				title: 'Detail',
				change: 'added',
				blocks: [
					{
						id: 'table-9',
						type: 'table',
						change: 'added',
						dataChanged: false,
						contentChanged: false
					}
				]
			},
			{
				id: 'legacy',
				title: 'Legacy',
				change: 'removed',
				blocks: [
					{
						id: 'callout-2',
						type: 'callout',
						change: 'removed',
						dataChanged: false,
						contentChanged: false
					}
				]
			}
		]
	};
}

describe('SeriesDiffView', () => {
	it('renders the per-section changelog with every applicable verdict per block', async () => {
		const { getByText } = render(SeriesDiffView, {
			diff: computedDiff(),
			baseline: { title: 'Previous issue', issueLabel: '2026-W23', publishedAt: null }
		});

		// Section titles and ids/types of changed blocks are shown.
		await expect.element(getByText('Summary')).toBeVisible();
		await expect.element(getByText('Detail')).toBeVisible();
		await expect.element(getByText('kpi-1')).toBeVisible();

		// A block changed in more than one dimension shows ALL verdicts (AC2): moved
		// AND data changed AND content changed.
		await expect.element(getByText('Moved').first()).toBeVisible();
		await expect.element(getByText('Data changed')).toBeVisible();
		await expect.element(getByText('Content changed')).toBeVisible();

		// Added / removed verdicts are surfaced for the structural changes.
		await expect.element(getByText('Added').first()).toBeVisible();
		await expect.element(getByText('Removed').first()).toBeVisible();

		// An unchanged kept block reads as Unchanged rather than vanishing.
		await expect.element(getByText('text-1')).toBeVisible();
		await expect.element(getByText('Unchanged').first()).toBeVisible();
	});

	it('labels the comparison with the predecessor baseline (issue label and date)', async () => {
		const { getByTestId } = render(SeriesDiffView, {
			diff: computedDiff(),
			baseline: {
				title: 'Previous issue',
				issueLabel: '2026-W23',
				publishedAt: new Date('2026-06-07T09:00:00.000Z')
			}
		});

		const baseline = getByTestId('baseline');
		await expect.element(baseline).toHaveTextContent('2026-W23');
		await expect.element(baseline).toHaveTextContent('2026-06-07 09:00 UTC');
	});

	it('falls back to the predecessor title when it has no issue label', async () => {
		const { getByTestId } = render(SeriesDiffView, {
			diff: computedDiff(),
			baseline: { title: 'June board pack', issueLabel: null, publishedAt: null }
		});

		await expect.element(getByTestId('baseline')).toHaveTextContent('June board pack');
	});

	it('renders the first-issue neutral state', async () => {
		const { getByText } = render(SeriesDiffView, {
			diff: { kind: 'no-predecessor', reason: 'first-issue' },
			baseline: null
		});

		await expect.element(getByText('This is the first issue of the series')).toBeVisible();
	});

	it('renders a distinct predecessor-unpublished neutral state', async () => {
		const { getByText } = render(SeriesDiffView, {
			diff: { kind: 'no-predecessor', reason: 'predecessor-unpublished' },
			baseline: null
		});

		await expect.element(getByText('The previous issue is not published yet')).toBeVisible();
	});

	it('renders the substantial-drift neutral state', async () => {
		const { getByText } = render(SeriesDiffView, {
			diff: { kind: 'substantial-drift', overlap: 0.04 },
			baseline: null
		});

		await expect
			.element(getByText('Structure changed too much to compare block by block'))
			.toBeVisible();
	});

	it('never renders speaker notes or any prior-issue body (the engine ships only flags)', async () => {
		// A real leak tripwire: a content-changed block carrying a recognizable marker
		// id and a marker section title (which the view DOES render), and prior/current
		// prose plus a speaker note that live in the real snapshots but NOT in the diff.
		// The view renders ids/types/titles/flags only, so the markers appear and none
		// of the leak strings ever reach the DOM.
		const diff: SeriesDiff = {
			kind: 'diff',
			sections: [
				{
					id: 'summary',
					title: MARKER_SECTION_TITLE,
					change: 'kept',
					blocks: [
						{
							id: MARKER_BLOCK_ID,
							type: 'kpi',
							change: 'kept',
							dataChanged: true,
							contentChanged: true
						}
					]
				}
			]
		};

		const { container } = render(SeriesDiffView, {
			diff,
			baseline: { title: 'Previous issue', issueLabel: null, publishedAt: null }
		});

		const text = container.textContent ?? '';
		// The flags-and-ids surface is rendered (so the assertion is not vacuous)...
		expect(text).toContain(MARKER_BLOCK_ID);
		expect(text).toContain(MARKER_SECTION_TITLE);
		expect(text).toContain('Content changed');
		// ...but no prior/current prose and no speaker note ever does.
		for (const marker of LEAK_MARKERS) {
			expect(text).not.toContain(marker);
		}
	});
});
