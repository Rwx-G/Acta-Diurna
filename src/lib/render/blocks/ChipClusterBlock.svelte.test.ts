import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ChipClusterBlock as ChipClusterBlockType, Scales } from '$lib/schema';
import ChipClusterBlock from './ChipClusterBlock.svelte';

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

function block(overrides: Partial<ChipClusterBlockType> = {}): ChipClusterBlockType {
	return {
		type: 'chip-cluster',
		id: 'statuses',
		scaleRef: 'status',
		entries: ['done', 'blocked'],
		...overrides
	};
}

describe('ChipClusterBlock render', () => {
	it('renders one pill per listed entry', () => {
		const { container } = render(ChipClusterBlock, { block: block(), scales });
		expect(container.querySelectorAll('.chip').length).toBe(2);
		expect(container.querySelectorAll('.badge').length).toBe(2);
	});

	it('carries the entry label text on every pill (colour is never alone, AAA)', () => {
		const { container } = render(ChipClusterBlock, { block: block(), scales });
		const labels = Array.from(container.querySelectorAll('.badge')).map((b) =>
			b.textContent?.trim()
		);
		expect(labels).toEqual(['Done', 'Blocked']);
	});

	it('derives pill colour from the scale (default-palette token and explicit hex)', () => {
		const { container } = render(ChipClusterBlock, { block: block(), scales });
		const badges = Array.from(container.querySelectorAll('.badge')) as HTMLElement[];
		// done index 0 -> categorical token #66023c; blocked carries explicit #7a2e3a.
		expect(badges[0].getAttribute('style')).toContain('--badge-color: #66023c');
		expect(badges[1].getAttribute('style')).toContain('--badge-color: #7a2e3a');
	});

	it('renders the optional block title', () => {
		const { container } = render(ChipClusterBlock, {
			block: block({ title: 'Workstreams' }),
			scales
		});
		expect(container.querySelector('.cluster-title')?.textContent?.trim()).toBe('Workstreams');
	});

	it('renders the same entry twice when listed twice', () => {
		const { container } = render(ChipClusterBlock, {
			block: block({ entries: ['done', 'done'] }),
			scales
		});
		const labels = Array.from(container.querySelectorAll('.badge')).map((b) =>
			b.textContent?.trim()
		);
		expect(labels).toEqual(['Done', 'Done']);
	});

	it('falls back to a placeholder when the referenced scale is missing', () => {
		const { container } = render(ChipClusterBlock, {
			block: block({ scaleRef: 'ghost' }),
			scales
		});
		expect(container.querySelector('.chip-cluster')).toBeNull();
		expect(container.querySelector('.block-placeholder')).not.toBeNull();
	});
});
