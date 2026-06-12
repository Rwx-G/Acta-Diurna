import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { KpiBlock as KpiBlockType, KpiItem } from '$lib/schema';
import KpiBlock from './KpiBlock.svelte';

function block(overrides: Partial<KpiBlockType> = {}): KpiBlockType {
	return {
		type: 'kpi',
		id: 'metrics',
		items: [{ label: 'Coverage', value: 92, unit: '%' }],
		...overrides
	};
}

describe('KpiBlock render', () => {
	it('renders a quiet placeholder when there are no static items', () => {
		const { container } = render(KpiBlock, { block: block({ items: undefined }) });
		expect(container.querySelector('.kpi-row')).toBeNull();
		expect(container.querySelector('.block-placeholder')).not.toBeNull();
	});

	it('renders one KPI cell per item with its label, value and unit', () => {
		const { container } = render(KpiBlock, {
			block: block({
				items: [
					{ label: 'Coverage', value: 92, unit: '%' },
					{ label: 'Findings', value: 7 }
				]
			})
		});
		expect(container.querySelectorAll('.kpi').length).toBe(2);

		const first = container.querySelector('.kpi') as HTMLElement;
		expect(first.querySelector('dt')?.textContent?.trim()).toBe('Coverage');
		expect(first.querySelector('.value')?.textContent?.trim()).toBe('92');
		expect(first.querySelector('.unit')?.textContent?.trim()).toBe('%');
	});

	it('renders no unit element when the item has no unit', () => {
		const { container } = render(KpiBlock, {
			block: block({ items: [{ label: 'Findings', value: 7 }] })
		});
		expect(container.querySelector('.unit')).toBeNull();
	});

	it('renders a string KPI value verbatim', () => {
		const { container } = render(KpiBlock, {
			block: block({ items: [{ label: 'Status', value: 'On track' }] })
		});
		expect(container.querySelector('.value')?.textContent?.trim()).toBe('On track');
	});

	it.each([
		['up', '▲', 'trending up'],
		['down', '▼', 'trending down'],
		['flat', '▬', 'unchanged']
	] as const)(
		'renders the %s trend glyph (decorative) alongside its visually-hidden accessible text',
		(trend, glyph, label) => {
			const item: KpiItem = { label: 'Coverage', value: 92, unit: '%', trend };
			const { container } = render(KpiBlock, { block: block({ items: [item] }) });

			const trendEl = container.querySelector(`.trend.trend-${trend}`) as HTMLElement | null;
			expect(trendEl).not.toBeNull();

			const glyphEl = trendEl?.querySelector('[aria-hidden="true"]');
			expect(glyphEl?.textContent?.trim()).toBe(glyph);

			// Colour and glyph are never the sole signal: a screen-reader label carries
			// the trend direction in words.
			expect(trendEl?.querySelector('.sr-only')?.textContent?.trim()).toBe(label);
		}
	);

	it('renders no trend element when the item has no trend', () => {
		const { container } = render(KpiBlock, {
			block: block({ items: [{ label: 'Coverage', value: 92 }] })
		});
		expect(container.querySelector('.trend')).toBeNull();
	});

	it('escapes an HTML-looking label and value instead of rendering them (XSS rule)', () => {
		const { container } = render(KpiBlock, {
			block: block({
				items: [{ label: '<script>alert(1)</script>', value: '<b>x</b>' }]
			})
		});
		expect(container.querySelector('script')).toBeNull();
		expect(container.querySelector('.value b')).toBeNull();
		expect(container.textContent).toContain('<script>alert(1)</script>');
		expect(container.textContent).toContain('<b>x</b>');
	});
});
