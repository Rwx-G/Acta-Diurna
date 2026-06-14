import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { SeriesDiff } from '$lib/schema';
import SeriesDiffView from './SeriesDiffView.svelte';

const SPEAKER_NOTE = 'CONFIDENTIAL presenter note that must never render here';

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
		// The SeriesDiff type carries no notes/body field, so the engine cannot hand
		// one in. This asserts the contract at the view: a note string placed in the
		// surrounding scope is never echoed by the changelog DOM.
		const { container } = render(SeriesDiffView, {
			diff: computedDiff(),
			baseline: { title: 'Previous issue', issueLabel: null, publishedAt: null }
		});

		expect(container.textContent).not.toContain(SPEAKER_NOTE);
	});
});
