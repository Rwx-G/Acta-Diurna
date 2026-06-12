import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Scales, TimelineBlock as TimelineBlockType } from '$lib/schema';
import TimelineBlock from './TimelineBlock.svelte';

const scales: Scales = [
	{
		key: 'status',
		label: 'Status',
		kind: 'nominal',
		entries: [
			{ key: 'done', label: 'Done' },
			{ key: 'in-progress', label: 'In progress' },
			{ key: 'blocked', label: 'Blocked', color: '#7a2e3a' }
		]
	}
];

function block(overrides: Partial<TimelineBlockType> = {}): TimelineBlockType {
	return {
		type: 'timeline',
		id: 'roadmap',
		milestones: [
			{
				label: 'Kickoff',
				date: 'Q1 2026',
				detail: [[{ text: 'Scope confirmed.' }]],
				status: { scaleRef: 'status', entry: 'done' }
			},
			{ label: 'Launch', status: { scaleRef: 'status', entry: 'blocked' } }
		],
		...overrides
	};
}

describe('TimelineBlock render', () => {
	it('renders one ordered node per milestone in declared order', () => {
		const { container } = render(TimelineBlock, { block: block(), scales });
		const items = container.querySelectorAll('.timeline > .milestone');
		expect(items).toHaveLength(2);
		// A real <ol> carries the order (semantic, not a hand-authored number).
		expect(container.querySelector('ol.timeline')).not.toBeNull();
		const labels = Array.from(container.querySelectorAll('.milestone-label')).map((l) =>
			l.textContent?.trim()
		);
		expect(labels).toEqual(['Kickoff', 'Launch']);
	});

	it('renders a status badge per milestone carrying the entry label (colour never alone, AAA)', () => {
		const { container } = render(TimelineBlock, { block: block(), scales });
		const labels = Array.from(container.querySelectorAll('.badge')).map((b) =>
			b.textContent?.trim()
		);
		expect(labels).toEqual(['Done', 'Blocked']);
	});

	it('derives the badge colour from the referenced scale (default token and explicit hex)', () => {
		const { container } = render(TimelineBlock, { block: block(), scales });
		const badges = Array.from(container.querySelectorAll('.badge')) as HTMLElement[];
		// done index 0 -> categorical token #66023c; blocked carries explicit #7a2e3a.
		expect(badges[0].getAttribute('style')).toContain('--badge-color: #66023c');
		expect(badges[1].getAttribute('style')).toContain('--badge-color: #7a2e3a');
	});

	it('renders the optional date sub-label when set, omits it otherwise', () => {
		const { container } = render(TimelineBlock, { block: block(), scales });
		const dates = Array.from(container.querySelectorAll('.milestone-date')).map((d) =>
			d.textContent?.trim()
		);
		// Only the first milestone carries a date.
		expect(dates).toEqual(['Q1 2026']);
	});

	it('renders the rich-text detail with inline-run formatting', () => {
		const { container } = render(TimelineBlock, {
			block: block({
				milestones: [
					{
						label: 'Ship',
						detail: [[{ text: 'See ' }, { text: 'the runbook', bold: true }, { text: ' first.' }]],
						status: { scaleRef: 'status', entry: 'done' }
					}
				]
			}),
			scales
		});
		expect(container.querySelector('.milestone-detail strong')?.textContent?.trim()).toBe(
			'the runbook'
		);
		expect(container.querySelector('.milestone-detail')?.textContent).toContain(
			'See the runbook first.'
		);
	});

	it('renders a detail link as an external http(s) anchor', () => {
		const { container } = render(TimelineBlock, {
			block: block({
				milestones: [
					{
						label: 'Docs',
						detail: [[{ text: 'docs', link: { href: 'https://example.com' } }]],
						status: { scaleRef: 'status', entry: 'done' }
					}
				]
			}),
			scales
		});
		const link = container.querySelector(
			'.milestone-detail a.run-link'
		) as HTMLAnchorElement | null;
		expect(link?.getAttribute('href')).toBe('https://example.com');
		expect(link?.getAttribute('rel')).toBe('external noopener noreferrer');
	});

	it('escapes an HTML-looking detail run instead of rendering it (XSS rule)', () => {
		const { container } = render(TimelineBlock, {
			block: block({
				milestones: [
					{
						label: 'Safe',
						detail: [[{ text: '<script>alert(1)</script>' }]],
						status: { scaleRef: 'status', entry: 'done' }
					}
				]
			}),
			scales
		});
		expect(container.querySelector('.milestone-detail script')).toBeNull();
		expect(container.querySelector('.milestone-detail')?.textContent).toContain(
			'<script>alert(1)</script>'
		);
	});

	it('renders the optional block title', () => {
		const { container } = render(TimelineBlock, {
			block: block({ title: 'Delivery plan' }),
			scales
		});
		expect(container.querySelector('.timeline-title')?.textContent?.trim()).toBe('Delivery plan');
	});

	it('omits the badge when the referenced scale is missing (preview path), keeping the label', () => {
		const { container } = render(TimelineBlock, {
			block: block({
				milestones: [{ label: 'Orphan', status: { scaleRef: 'ghost', entry: 'done' } }]
			}),
			scales
		});
		// The milestone still renders its label; only the badge is dropped when the
		// scale cannot resolve (the cross-reference pass flags it at save/API time).
		expect(container.querySelector('.milestone-label')?.textContent?.trim()).toBe('Orphan');
		expect(container.querySelector('.badge')).toBeNull();
	});

	it('renders the node markers (the SSR connector) decorative', () => {
		const { container } = render(TimelineBlock, { block: block(), scales });
		const nodes = container.querySelectorAll('.node');
		expect(nodes).toHaveLength(2);
		expect(nodes[0].getAttribute('aria-hidden')).toBe('true');
	});
});
