<script lang="ts">
	import { tick } from 'svelte';
	import { AUDIENCES, type BlockType, type Scales, type Section } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';
	import BlockEditor from './BlockEditor.svelte';
	import BlockPalette from './BlockPalette.svelte';
	import IssueList from './IssueList.svelte';
	import { moveItem, newBlock, type ErrorsByKey, type MatrixBlockOption } from './editor-state';
	import type { DiagnosticContext, EditorSelection } from './editor-types';

	interface Props {
		section: Section;
		sectionIndex: number;
		count: number;
		errors: ErrorsByKey;
		/** Document scales, threaded to the comparison-matrix block editor. */
		scales?: Scales;
		/** Comparison-matrix blocks in the document, for the set-membership editor. */
		matrixBlocks?: MatrixBlockOption[];
		/** Per-block binding diagnostics, for the block's compact drift ("Derive") tag (Epic 10.5). */
		diagnostics?: DiagnosticContext;
		/** The currently selected element (drives the inspector + the selection ring). */
		selected: EditorSelection;
		/** Reports a new selection UP so the inspector follows (UX redesign). */
		onSelect: (target: EditorSelection) => void;
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
		diagnostics,
		selected,
		onSelect,
		onEdit,
		onRemove,
		onMove
	}: Props = $props();

	const sectionIssues = $derived(errors[`section:${section.id}`] ?? []);
	const isSelected = $derived(selected?.kind === 'section' && selected.id === section.id);

	// Compact at-a-glance state for the calm header (UX redesign): show the audience
	// tags only when the section is restricted to a subset of levels (the default,
	// all-levels, reads as no badge), and a "Notes" dot when speaker notes are present.
	// Non-interactive - the controls live in the inspector.
	const audienceLabel = $derived(
		section.audiences && section.audiences.length > 0 && section.audiences.length < AUDIENCES.length
			? section.audiences.join(', ')
			: null
	);
	const hasNotes = $derived((section.notes?.length ?? 0) > 0);

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
	// empties the block list (no block card remains to land on). The palette is a
	// disclosure now, so the empty-section path OPENS it before focusing the entry.
	let paletteFirstEntry = $state<HTMLButtonElement>();
	let paletteOpen = $state(false);

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
		// else nothing remains - open the palette and fall back to its first entry.
		const next = section.blocks[index] ?? section.blocks[index - 1];
		if (next) {
			void focusBlock(next.id);
		} else {
			paletteOpen = true;
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

	function selectSection(): void {
		onSelect({ kind: 'section', id: section.id });
	}
</script>

<!-- `tabindex="-1"` + `data-section-id` make this card a scriptable focus target so
     the editor's section-level structural-edit focus management (add / move / delete
     a section) can move focus to the right section without putting the card in the tab
     order (Story 10.2, NFR15). -->
<section
	class="section-card"
	class:selected={isSelected}
	aria-label={`Section: ${section.title}`}
	tabindex="-1"
	data-section-id={section.id}
>
	<!-- The header is the section's selection target: clicking the title area or
	     focusing into it selects the section, so the inspector shows its audience +
	     notes. The gutter controls are revealed on hover/focus/selection with a
	     persistent affordance hint (WCAG 2.2 SC 3.2.7). -->
	<header class="section-head" onclickcapture={selectSection} onfocusin={selectSection}>
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
		<div class="section-meta" aria-hidden="true">
			{#if audienceLabel}<span class="mini-tag">{audienceLabel}</span>{/if}
			{#if hasNotes}<span class="notes-dot" title="Has speaker notes">Notes</span>{/if}
		</div>
		<div class="gutter">
			<span class="gutter-hint" aria-hidden="true">&#8943;</span>
			<div class="controls">
				<Button
					onclick={() => onMove(-1)}
					disabled={sectionIndex === 0}
					aria-label="Move section up"
				>
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
		</div>
	</header>

	<IssueList issues={sectionIssues} variant="section" />

	<div class="block-list" bind:this={blockListElement}>
		{#each section.blocks as block, blockIndex (block.id)}
			<BlockEditor
				bind:block={section.blocks[blockIndex]}
				{blockIndex}
				count={section.blocks.length}
				issues={errors[`block:${block.id}`] ?? []}
				{scales}
				{matrixBlocks}
				diagnostic={diagnostics?.byBlock.get(block.id)}
				selected={selected?.kind === 'block' && selected.id === block.id}
				{onSelect}
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
		bind:open={paletteOpen}
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

	/* The selected section carries the same purple ring as :focus-visible, so the
	   selection state reads in the same visual language as keyboard focus. */
	.section-card.selected {
		border-color: var(--color-purple);
		box-shadow: 0 0 0 1px var(--color-purple);
	}

	.section-head {
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

	.section-meta {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.mini-tag {
		font-size: var(--text-xs);
		font-weight: 600;
		padding: 1px var(--space-2);
		color: var(--color-ink-65);
		background: var(--color-ink-08);
		border-radius: var(--radius-pill);
		text-transform: capitalize;
	}

	.notes-dot {
		font-size: var(--text-xs);
		font-weight: 600;
		padding: 1px var(--space-2);
		color: var(--color-ink-65);
		background: var(--color-stone);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-pill);
	}

	/* Hover/focus-revealed gutter (UX redesign, WCAG 2.2 SC 3.2.7). At rest the
	   control cluster is opacity:0 but the gutter keeps a PERSISTENT faint glyph so the
	   author knows controls exist; hover, focus-within, and selection reveal the
	   buttons. The buttons stay in the DOM and the tab order (a keyboard focus reveals
	   them via :focus-within), so no control is hover-only. */
	.gutter {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.gutter-hint {
		color: var(--color-ink-25);
		font-size: var(--text-sm);
	}

	.controls {
		display: flex;
		gap: var(--space-1);
		opacity: 0;
		transition: opacity 0.12s ease;
	}

	.section-card:hover .controls,
	.section-card:focus-within .controls,
	.section-card.selected .controls {
		opacity: 1;
	}

	/* The ghost Remove button's default text (`--color-ink-65`) drops below the WCAG AA
	   4.5:1 floor on the light `--color-surface` card; pin the gutter ghost text to a
	   darker ink so the revealed control is AA-clean (the same discipline as the draft
	   status chip fix). Scoped to the gutter so the global ghost variant is untouched. */
	.controls :global(.btn.ghost) {
		color: var(--color-ink-80);
	}
</style>
