import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { BindingDelta } from '$lib/schema';
import KpiDelta, { formatDelta } from './KpiDelta.svelte';

function delta(overrides: Partial<BindingDelta> = {}): BindingDelta {
	return { direction: 'up', priorValue: 100, absolute: 8, relative: 0.08, ...overrides };
}

describe('formatDelta', () => {
	it('formats a positive change with the signed absolute and percent', () => {
		expect(formatDelta(delta())).toBe('+8 (+8%)');
	});

	it('formats a negative change with leading minus signs (direction in the figure, not colour)', () => {
		expect(formatDelta(delta({ direction: 'down', absolute: -30, relative: -0.25 }))).toBe(
			'-30 (-25%)'
		);
	});

	it('drops the percent against a zero baseline (null relative)', () => {
		expect(formatDelta(delta({ priorValue: 0, absolute: 5, relative: null }))).toBe('+5');
	});

	it('shows a +0 flat change rather than omitting it', () => {
		expect(formatDelta(delta({ direction: 'flat', absolute: 0, relative: 0 }))).toBe('+0 (+0%)');
	});
});

describe('KpiDelta render', () => {
	it('renders nothing when no delta is supplied (omitted, no placeholder)', () => {
		const { container } = render(KpiDelta, { delta: undefined });
		expect(container.querySelector('.kpi-delta')).toBeNull();
		expect(container.textContent?.trim()).toBe('');
	});

	it.each([
		['up', '▲', 'up'],
		['down', '▼', 'down'],
		['flat', '▬', 'no change']
	] as const)(
		'renders the %s direction glyph (decorative) with its visually-hidden accessible word',
		(direction, glyph, word) => {
			const { container } = render(KpiDelta, { delta: delta({ direction }) });
			const root = container.querySelector(`.kpi-delta.kpi-delta-${direction}`) as HTMLElement;
			expect(root).not.toBeNull();

			const glyphEl = root.querySelector('.glyph[aria-hidden="true"]');
			expect(glyphEl?.textContent?.trim()).toBe(glyph);

			// Colour is never the sole signal: a screen-reader word and a signed figure
			// both carry the direction (NFR14).
			expect(root.querySelector('.sr-only')?.textContent?.trim()).toBe(word);
		}
	);

	it('renders the signed figure and the fixed baseline label', () => {
		const { container } = render(KpiDelta, { delta: delta() });
		expect(container.querySelector('.figure')?.textContent?.trim()).toBe('+8 (+8%)');
		expect(container.querySelector('.baseline')?.textContent?.trim()).toBe('vs previous issue');
	});
});
