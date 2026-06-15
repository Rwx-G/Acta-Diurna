<script lang="ts">
	import { tick } from 'svelte';
	import type { BlockType, Scales, Section } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';
	import AudiencePicker from './AudiencePicker.svelte';
	import BlockEditor from './BlockEditor.svelte';
	import BlockPalette from './BlockPalette.svelte';
	import IssueList from './IssueList.svelte';
	import { moveItem, newBlock, type ErrorsByKey, type MatrixBlockOption } from './editor-state';

	interface Props {
		section: Section;
		sectionIndex: number;
		count: number;
		errors: ErrorsByKey;
		/** Document scales, threaded to the comparison-matrix block editor. */
		scales?: Scales;
		/** Comparison-matrix blocks in the document, for the set-membership editor. */
		matrixBlocks?: MatrixBlockOption[];
		onEdit: () => void;
		onRemove: () => void;
		onMove: (direction: -1 | 1) => void;
	}

	let {
		section = $bindable(),
		sectionIndex,
		count,
		errors,
		scales,
		matrixBlocks,
		onEdit,
		onRemove,
		onMove
	}: Props = $props();

	const sectionIssues = $derived(errors[`section:${section.id}`] ?? []);

	// Structural-edit focus management (Story 10.2, NFR15). A structural change
	// (add / move / delete a block) tears down and rebuilds the keyed `{#each}`, so
	// the control the author activated is gone after the update. We record a focus
	// INTENT (a stable block id) on each structural edit and move focus to that
	// block's card once the DOM has settled (`tick()`), so a keyboard / screen-reader
	// user never loses their place: a moved block keeps focus, an added block is
	// focused, and after a delete focus lands on the neighbour that took its place
	// (or the palette when the section is emptied). The card is a `tabindex="-1"`
	// region (focusable by script, not in the tab order) so focus can rest on it.
	let blockListElement = $state<HTMLDivElement>();
	// The palette's first entry button, the focus-fallback target when a delete
	// empties the block list (no block card remains to land on). Ref-anchored, like
	// the `addSectionButton` fallback in ReportEditor, so the empty-section focus
	// path needs no DOM traversal.
	let paletteFirstEntry = $state<HTMLButtonElement>();

	async function focusBlock(blockId: string): Promise<void> {
		await tick();
		blockListElement
			?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`)
			?.focus();
	}

	function insertBlock(type: BlockType): void {
		const block = newBlock(type);
		section.blocks.push(block);
		onEdit();
		void focusBlock(block.id);
	}

	function removeBlock(index: number): void {
		section.blocks.splice(index, 1);
		onEdit();
		// Focus the block that slid into the removed slot, else the previous block,
		// else nothing remains in the list - fall back to the palette's first entry.
		const next = section.blocks[index] ?? section.blocks[index - 1];
		if (next) {
			void focusBlock(next.id);
		} else {
			void tick().then(() => paletteFirstEntry?.focus());
		}
	}

	function moveBlock(index: number, direction: -1 | 1): void {
		const movedId = section.blocks[index].id;
		moveItem(section.blocks, index, direction);
		onEdit();
		// Keep focus on the moved block so repeated up/down presses keep working
		// from the keyboard without re-acquiring the control.
		void focusBlock(movedId);
	}
</script>

<!-- `tabindex="-1"` + `data-section-id` make this card a scriptable focus target so
     the editor's section-level structural-edit focus management (add / move / delete
     a section) can move focus to the right section without putting the card in the tab
     order (Story 10.2, NFR15). -->
<section
	class="section-card"
	aria-label={`Section: ${section.title}`}
	tabindex="-1"
	data-section-id={section.id}
>
	<header>
		<input
			class="section-title"
			name={`section-title:${sectionIndex}`}
			value={section.title}
			oninput={(event) => {
				section.title = event.currentTarget.value;
				onEdit();
			}}
			aria-label="Section title"
		/>
		<div class="controls">
			<Button onclick={() => onMove(-1)} disabled={sectionIndex === 0} aria-label="Move section up">
				Up
			</Button>
			<Button
				onclick={() => onMove(1)}
				disabled={sectionIndex === count - 1}
				aria-label="Move section down"
			>
				Down
			</Button>
			<Button variant="ghost" onclick={onRemove} aria-label="Remove section">Remove</Button>
		</div>
	</header>

	<AudiencePicker bind:audiences={section.audiences} legend="Section audiences" {onEdit} />

	<IssueList issues={sectionIssues} variant="section" />

	<div class="block-list" bind:this={blockListElement}>
		{#each section.blocks as block, blockIndex (block.id)}
			<BlockEditor
				bind:block={section.blocks[blockIndex]}
				{sectionIndex}
				{blockIndex}
				count={section.blocks.length}
				issues={errors[`block:${block.id}`] ?? []}
				{scales}
				{matrixBlocks}
				{onEdit}
				onRemove={() => removeBlock(blockIndex)}
				onMove={(direction) => moveBlock(blockIndex, direction)}
			/>
		{/each}
	</div>

	<BlockPalette
		label={`Add a block to ${section.title}`}
		onInsert={insertBlock}
		bind:firstEntry={paletteFirstEntry}
	/>
</section>

<style>
	.section-card {
		margin-bottom: var(--space-5);
		padding: var(--space-4) var(--space-5);
		background: var(--color-surface);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-md);
	}

	/* The card is a scripted focus target (section-level structural-edit focus
	   management); show a clear focus ring when focus lands on it. */
	.section-card:focus-visible {
		outline: 2px solid var(--color-purple);
		outline-offset: 2px;
	}

	header {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin-bottom: var(--space-3);
	}

	.section-title {
		flex: 1;
		min-width: 0;
		padding: var(--space-2) var(--space-3);
		font: inherit;
		font-size: var(--text-lg);
		font-weight: 600;
		color: inherit;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
	}

	.section-title:hover,
	.section-title:focus {
		background: var(--color-stone);
		border-color: var(--color-ink-25);
	}

	.controls {
		display: flex;
		gap: var(--space-1);
	}
</style>
