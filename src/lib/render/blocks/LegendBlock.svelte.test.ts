import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { LegendBlock as LegendBlockType, Scales } from '$lib/schema';
import LegendBlock from './LegendBlock.svelte';

const scales: Scales = [
	{
		key: 'sources',
		label: 'Sources',
		kind: 'nominal',
		entries: [
			{ key: 'siem', label: 'SIEM', sublabel: 'Log correlation' },
			{ key: 'edr', label: 'EDR' }
		]
	},
	{
		key: 'severity',
		label: 'Severity',
		kind: 'ordinal',
		entries: [{ key: 'critical', label: 'Critical', color: '#7a2e3a' }]
	}
];

function block(overrides: Partial<LegendBlockType> = {}): LegendBlockType {
	return {
		type: 'legend',
		id: 'source-legend',
		scaleRef: 'sources',
		...overrides
	};
}

describe('LegendBlock render', () => {
	it('renders one swatch per entry of the referenced scale', () => {
		const { container } = render(LegendBlock, { block: block(), scales });
		expect(container.querySelectorAll('.entry').length).toBe(2);
		expect(container.querySelectorAll('.swatch').length).toBe(2);
	});

	it('carries the entry label text on every swatch (colour is never alone, AAA)', () => {
		const { container } = render(LegendBlock, { block: block(), scales });
		const labels = Array.from(container.querySelectorAll('.entry-label')).map((l) =>
			l.textContent?.trim()
		);
		expect(labels).toEqual(['SIEM', 'EDR']);
	});

	it('renders the optional sublabel from the scale entry', () => {
		const { container } = render(LegendBlock, { block: block(), scales });
		const sublabels = Array.from(container.querySelectorAll('.entry-sublabel')).map((s) =>
			s.textContent?.trim()
		);
		expect(sublabels).toEqual(['Log correlation']);
	});

	it('renders the optional block title', () => {
		const { container } = render(LegendBlock, { block: block({ title: 'Data sources' }), scales });
		expect(container.querySelector('.legend-title')?.textContent?.trim()).toBe('Data sources');
	});

	it('marks the colour chip decorative (aria-hidden) so colour is not the sole signal', () => {
		const { container } = render(LegendBlock, { block: block(), scales });
		expect(container.querySelector('.swatch')?.getAttribute('aria-hidden')).toBe('true');
	});

	it('derives swatch colour from the scale: a default-palette entry uses the categorical token', () => {
		const { container } = render(LegendBlock, { block: block(), scales });
		// siem is index 0 with no explicit colour -> --report-chart-1 = #66023c, the
		// SAME colour the matrix resolves for that source entry (colour-language parity).
		const swatch = container.querySelector('.swatch') as HTMLElement | null;
		expect(swatch?.getAttribute('style')).toContain('--swatch-color: #66023c');
	});

	it('derives swatch colour from the scale: an explicit author hex is used verbatim', () => {
		const { container } = render(LegendBlock, { block: block({ scaleRef: 'severity' }), scales });
		const swatch = container.querySelector('.swatch') as HTMLElement | null;
		expect(swatch?.getAttribute('style')).toContain('--swatch-color: #7a2e3a');
	});

	it('escapes an HTML-looking entry label instead of rendering it (XSS rule)', () => {
		const evil: Scales = [
			{
				key: 'sources',
				label: 'Sources',
				entries: [{ key: 'siem', label: '<script>alert(1)</script>' }]
			}
		];
		const { container } = render(LegendBlock, { block: block(), scales: evil });
		expect(container.querySelector('script')).toBeNull();
		expect(container.textContent).toContain('<script>alert(1)</script>');
	});

	it('falls back to a placeholder when the referenced scale is missing', () => {
		const { container } = render(LegendBlock, { block: block({ scaleRef: 'ghost' }), scales });
		expect(container.querySelector('.legend')).toBeNull();
		expect(container.querySelector('.block-placeholder')).not.toBeNull();
	});
});
