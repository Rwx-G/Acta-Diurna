import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { ICON_NAMES, type IconName } from '$lib/schema';
import Icon from './Icon.svelte';
import { ICON_REGISTRY } from './icons.ts';

describe('Icon registry / enum lockstep', () => {
	it('has a registry entry for every enum name and no extra (cannot drift)', () => {
		const registryNames = Object.keys(ICON_REGISTRY).sort();
		const enumNames = [...ICON_NAMES].sort();
		expect(registryNames).toEqual(enumNames);
	});

	it('draws at least one path for every glyph', () => {
		for (const name of ICON_NAMES) {
			expect(ICON_REGISTRY[name].length).toBeGreaterThan(0);
		}
	});
});

describe('Icon render', () => {
	it('renders an <svg> carrying at least one <path> for every enum name', () => {
		for (const name of ICON_NAMES) {
			const { container } = render(Icon, { name });
			const svg = container.querySelector('svg.icon');
			expect(svg, name).not.toBeNull();
			expect(svg?.querySelectorAll('path').length, name).toBeGreaterThan(0);
		}
	});

	it('marks the icon decorative (aria-hidden + focusable="false") so it is never the sole signal (NFR14)', () => {
		const { container } = render(Icon, { name: 'check' satisfies IconName });
		const svg = container.querySelector('svg.icon');
		expect(svg?.getAttribute('aria-hidden')).toBe('true');
		expect(svg?.getAttribute('focusable')).toBe('false');
	});

	it('strokes in currentColor with no hardcoded colour, so it inherits the token context', () => {
		const { container } = render(Icon, { name: 'info' satisfies IconName });
		const svg = container.querySelector('svg.icon');
		expect(svg?.getAttribute('stroke')).toBe('currentColor');
		expect(svg?.getAttribute('fill')).toBe('none');
		// No path carries its own fill/stroke colour - colour comes only from the svg.
		for (const path of Array.from(container.querySelectorAll('path'))) {
			expect(path.getAttribute('fill')).toBeNull();
			expect(path.getAttribute('stroke')).toBeNull();
		}
	});

	it('sizes from the surrounding context (1em square), so callers control size via font-size', () => {
		const { container } = render(Icon, { name: 'shield' satisfies IconName });
		const svg = container.querySelector('svg.icon') as SVGElement | null;
		const styles = svg ? getComputedStyle(svg) : null;
		expect(styles?.width).toBe(styles?.height);
	});
});
