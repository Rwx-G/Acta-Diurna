import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { BlockType } from '$lib/schema';
import BlockPalette from './BlockPalette.svelte';
import { blockPaletteEntries } from './editor-state';

describe('BlockPalette', () => {
	it('renders one labelled insert control per block-union member once opened', async () => {
		const { getByRole, container } = render(BlockPalette, {
			label: 'Add a block to Overview',
			onInsert: vi.fn()
		});

		// The palette is a disclosure now (UX redesign): the entries appear once the
		// "+ Ajouter un bloc" menu is opened, not always-expanded.
		await getByRole('button', { name: '+ Ajouter un bloc' }).click();

		// The opened popover is a labelled group (NFR15) so a screen reader announces the
		// purpose before the choices.
		await expect.element(getByRole('group', { name: 'Add a block to Overview' })).toBeVisible();

		// Exactly one entry button per catalogue entry (plus the disclosure toggle), each
		// carrying its accessible label.
		const buttons = container.querySelectorAll('button');
		expect(buttons.length).toBe(blockPaletteEntries.length + 1);
		for (const entry of blockPaletteEntries) {
			await expect
				.element(getByRole('button', { name: `Add a ${entry.label} block` }))
				.toBeVisible();
		}
	});

	it('reports the chosen block type when an entry is activated', async () => {
		const onInsert = vi.fn<(type: BlockType) => void>();
		const { getByRole } = render(BlockPalette, { label: 'Add a block', onInsert });

		await getByRole('button', { name: '+ Ajouter un bloc' }).click();
		await getByRole('button', { name: 'Add a Table block' }).click();

		expect(onInsert).toHaveBeenCalledExactlyOnceWith('table');
	});
});
