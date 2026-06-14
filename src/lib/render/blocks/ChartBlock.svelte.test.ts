import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ChartBlock as ChartBlockType } from '$lib/schema';
import ChartBlock from './ChartBlock.svelte';

function block(overrides: Partial<ChartBlockType> = {}): ChartBlockType {
	return {
		type: 'chart',
		id: 'trend',
		kind: 'line',
		series: [
			{
				name: 'Coverage',
				points: [
					{ x: 'Jan', y: 40 },
					{ x: 'Feb', y: 65 },
					{ x: 'Mar', y: 80 }
				]
			}
		],
		...overrides
	};
}

describe('ChartBlock render', () => {
	it('renders the chart as an SVG with role="img" labelled by its title (a11y alternative)', () => {
		const { container } = render(ChartBlock, {
			block: block({ legendLabel: 'Coverage over time' })
		});
		const svg = container.querySelector('svg.chart-svg');
		expect(svg).not.toBeNull();
		expect(svg?.getAttribute('role')).toBe('img');

		const labelledBy = svg?.getAttribute('aria-labelledby');
		expect(labelledBy).toBeTruthy();
		const title = svg?.querySelector('title');
		expect(title?.getAttribute('id')).toBe(labelledBy);
		expect(title?.textContent?.trim()).toBe('Coverage over time');
	});

	it('falls back to a "<kind> chart" accessible title when no legend label is given', () => {
		const { container } = render(ChartBlock, {
			block: block({ kind: 'bar', legendLabel: undefined })
		});
		expect(container.querySelector('svg.chart-svg title')?.textContent?.trim()).toBe('bar chart');
	});

	it('renders a placeholder instead of an SVG when there is no static series', () => {
		const { container } = render(ChartBlock, {
			block: block({
				series: undefined,
				binding: { fields: [{ name: 'month', type: 'string', slot: { role: 'x' } }] }
			})
		});
		expect(container.querySelector('svg.chart-svg')).toBeNull();
		expect(container.querySelector('.block-placeholder')).not.toBeNull();
	});

	it('renders a placeholder when every series is empty (no geometry)', () => {
		const { container } = render(ChartBlock, {
			block: block({ series: [{ name: 'Coverage', points: [] }] })
		});
		expect(container.querySelector('svg.chart-svg')).toBeNull();
		expect(container.querySelector('.block-placeholder')).not.toBeNull();
	});

	it('renders one legend item per series carrying the series name', () => {
		const { container } = render(ChartBlock, {
			block: block({
				series: [
					{ name: 'Coverage', points: [{ x: 'Jan', y: 1 }] },
					{ name: 'Backlog', points: [{ x: 'Jan', y: 2 }] }
				]
			})
		});
		const names = Array.from(container.querySelectorAll('.legend-item')).map((el) =>
			el.textContent?.trim()
		);
		expect(names).toEqual(['Coverage', 'Backlog']);
	});

	it('renders the category (x) labels as axis ticks', () => {
		const { container } = render(ChartBlock, { block: block() });
		const xTicks = Array.from(container.querySelectorAll('.x-tick')).map((t) =>
			t.textContent?.trim()
		);
		expect(xTicks).toEqual(['Jan', 'Feb', 'Mar']);
	});

	it('escapes an HTML-looking series name and accessible title instead of rendering them (XSS rule)', () => {
		const { container } = render(ChartBlock, {
			block: block({
				legendLabel: '<script>alert(1)</script>',
				series: [{ name: '<b>series</b>', points: [{ x: 'Jan', y: 1 }] }]
			})
		});
		expect(container.querySelector('script')).toBeNull();
		expect(container.querySelector('.legend-item b')).toBeNull();
		expect(container.querySelector('svg.chart-svg title')?.textContent?.trim()).toBe(
			'<script>alert(1)</script>'
		);
		expect(container.textContent).toContain('<b>series</b>');
	});

	it('shows the FR16 data-as-of caption when the binding carries a timestamp (Story 6.4)', () => {
		const { container } = render(ChartBlock, {
			block: block({
				binding: {
					dataSetId: 'ds-1',
					dataAsOf: '2026-06-08T09:30:00.000Z',
					fields: [{ name: 'week', type: 'date' }]
				}
			})
		});
		expect(container.querySelector('.data-as-of')?.textContent?.trim()).toBe(
			'Data as of 8 Jun 2026'
		);
	});

	it('omits the data-as-of caption when the block is not data-bound (static series)', () => {
		const { container } = render(ChartBlock, { block: block() });
		expect(container.querySelector('.data-as-of')).toBeNull();
	});

	it('omits the data-as-of caption when the binding carries no timestamp', () => {
		const { container } = render(ChartBlock, {
			block: block({
				binding: { dataSetId: 'ds-1', fields: [{ name: 'week', type: 'date' }] }
			})
		});
		expect(container.querySelector('.data-as-of')).toBeNull();
	});
});
