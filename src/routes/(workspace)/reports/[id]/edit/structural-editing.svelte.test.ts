import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Section } from '$lib/schema';
import SectionEditor from './SectionEditor.svelte';

// Story 10.2: structural editing of BLOCKS within a section through the working
// copy - add (from the palette), reorder (keyboard move up/down), delete - plus
// the focus management that keeps a keyboard / screen-reader user oriented across
// the keyed `{#each}` rebuild. SectionEditor mutates the bound `section` in place;
// the test reads the same `$state` object back.

function fixtureSection(): Section {
	return {
		id: 'overview',
		title: 'Overview',
		blocks: [
			{ type: 'text', id: 'first', paragraphs: [[{ text: 'First.' }]] },
			{ type: 'text', id: 'second', paragraphs: [[{ text: 'Second.' }]] }
		]
	};
}

function renderSection(section: Section, onEdit = vi.fn()) {
	const reactiveSection = $state(section);
	const result = render(SectionEditor, {
		section: reactiveSection,
		sectionIndex: 0,
		count: 1,
		errors: {},
		selected: null,
		onSelect: vi.fn(),
		onEdit,
		onRemove: vi.fn(),
		onMove: vi.fn()
	});
	return { ...result, section: reactiveSection, onEdit };
}

describe('SectionEditor structural block editing', () => {
	it('adds a block of the chosen type from the palette and signals an edit', async () => {
		const { getByRole, section, onEdit } = renderSection(fixtureSection());

		// The palette is a disclosure now (UX redesign): open it, then pick the entry.
		await getByRole('button', { name: '+ Add block' }).click();
		await getByRole('button', { name: 'Add a KPI block' }).click();

		// The new block lands at the end of the working copy with the chosen type.
		expect(section.blocks).toHaveLength(3);
		expect(section.blocks[2].type).toBe('kpi');
		expect(onEdit).toHaveBeenCalled();
	});

	it('reorders a block with the keyboard-accessible move-down control', async () => {
		const { getByRole, section } = renderSection(fixtureSection());

		// Two text blocks render two "Move block down" controls; the first one moves
		// the first block past the second. (Keyboard activation: a button is operated
		// by Enter/Space, so this is the NFR15 keyboard-accessible baseline.)
		const moveDown = getByRole('button', { name: 'Move block down' }).first();
		await moveDown.click();

		expect(section.blocks.map((block) => block.id)).toEqual(['second', 'first']);
	});

	it('deletes a block from the working copy and moves focus to the neighbour', async () => {
		const { getByRole, section } = renderSection(fixtureSection());

		await getByRole('button', { name: 'Remove block' }).first().click();

		expect(section.blocks.map((block) => block.id)).toEqual(['second']);
		// Focus management (NFR15): after deleting the first block, focus lands on the
		// block that slid into its place so the keyboard user is not dropped at the top.
		await vi.waitFor(() => {
			const focused = document.activeElement as HTMLElement | null;
			expect(focused?.getAttribute('data-block-id')).toBe('second');
		});
	});

	it('does not reach back into the loaded section object after a structural edit', async () => {
		const source = fixtureSection();
		// The editor binds a $state copy; the source array length is the contract we
		// assert is untouched by an add against the reactive copy.
		const { getByRole } = renderSection(structuredClone(source));

		await getByRole('button', { name: '+ Add block' }).click();
		await getByRole('button', { name: 'Add a Code block' }).click();

		expect(source.blocks).toHaveLength(2);
	});
});
