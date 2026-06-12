import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { CardGridBlock as CardGridBlockType } from '$lib/schema';
import CardGridBlock from './CardGridBlock.svelte';

function block(overrides: Partial<CardGridBlockType> = {}): CardGridBlockType {
	return {
		type: 'card-grid',
		id: 'highlights',
		columns: 3,
		items: [
			{ icon: 'shield', title: 'Secure by default', description: 'Strict CSP, no CDN.' },
			{ icon: 'bolt', title: 'Fast', description: 'Server-rendered, zero hydration.' },
			{ title: 'Self-hosted', description: 'Clone, configure, compose up.' }
		],
		...overrides
	};
}

describe('CardGridBlock render', () => {
	it('renders the grid with one card list item per item', () => {
		const { container } = render(CardGridBlock, { block: block() });
		expect(container.querySelector('ul.card-grid')).not.toBeNull();
		expect(container.querySelectorAll('.card-grid .card').length).toBe(3);
	});

	it('drives the desktop column count from block.columns (the responsive seam)', () => {
		const { container } = render(CardGridBlock, { block: block({ columns: 4 }) });
		const grid = container.querySelector('.card-grid') as HTMLElement | null;
		expect(grid?.style.getPropertyValue('--card-columns')).toBe('4');
	});

	it('renders the bold title and the description for each card', () => {
		const { container } = render(CardGridBlock, { block: block() });
		const titles = Array.from(container.querySelectorAll('.card-title')).map((t) =>
			t.textContent?.trim()
		);
		const descriptions = Array.from(container.querySelectorAll('.card-description')).map((d) =>
			d.textContent?.trim()
		);
		expect(titles).toEqual(['Secure by default', 'Fast', 'Self-hosted']);
		expect(descriptions).toEqual([
			'Strict CSP, no CDN.',
			'Server-rendered, zero hydration.',
			'Clone, configure, compose up.'
		]);
	});

	it('renders the optional icon when set and omits it when absent', () => {
		const { container } = render(CardGridBlock, { block: block() });
		const cards = container.querySelectorAll('.card');
		expect(cards[0].querySelector('.card-icon svg')).not.toBeNull();
		expect(cards[2].querySelector('.card-icon')).toBeNull();
	});

	it('marks the icon decorative (aria-hidden) so it is never the sole signal (NFR14)', () => {
		const { container } = render(CardGridBlock, { block: block() });
		expect(container.querySelector('.card-icon svg')?.getAttribute('aria-hidden')).toBe('true');
	});

	it('escapes an HTML-looking description instead of rendering it (XSS rule)', () => {
		const { container } = render(CardGridBlock, {
			block: block({
				columns: 1,
				items: [{ title: 'Scope', description: '<script>alert(1)</script>' }]
			})
		});
		expect(container.querySelector('.card-description script')).toBeNull();
		expect(container.querySelector('.card-description')?.textContent).toContain(
			'<script>alert(1)</script>'
		);
	});

	it('escapes an HTML-looking title instead of rendering it', () => {
		const { container } = render(CardGridBlock, {
			block: block({ columns: 1, items: [{ title: '<b>Status</b>', description: 'Final' }] })
		});
		expect(container.querySelector('.card-title b')).toBeNull();
		expect(container.querySelector('.card-title')?.textContent).toContain('<b>Status</b>');
	});
});
