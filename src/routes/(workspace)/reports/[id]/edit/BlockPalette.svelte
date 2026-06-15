<script lang="ts">
	import type { BlockType } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';
	import { blockPaletteEntries } from './editor-state';

	// The block palette (Story 10.2): one entry per member of the block
	// discriminated union (seeded from `blockPaletteEntries`, which is exhaustive
	// over `BlockType` at compile time, so a new block type can never be silently
	// missing). Picking an entry inserts a default-shaped block of that type via the
	// caller's `onInsert` (which calls `newBlock`) at the section's chosen position.
	// The palette adds NO new block type - it exposes the existing catalogue.
	//
	// Accessibility: the entries live in a labelled group (NFR15) so a screen reader
	// announces "Add a block" before the choices; each button carries an explicit
	// `aria-label` ("Add a <label> block") and a visible one-line description, so the
	// purpose is clear by keyboard and by screen reader. Insertion focus management
	// is the CALLER's concern (it owns the new block's DOM node); the palette only
	// reports the chosen type.
	interface Props {
		onInsert: (type: BlockType) => void;
		/** Labels the group so multiple palettes (one per section) read distinctly. */
		label: string;
		/**
		 * Bindable handle to the palette's FIRST entry button, for the caller's
		 * empty-section focus fallback (Story 10.2, NFR15): when a delete empties the
		 * block list there is no block card left to land focus on, so `SectionEditor`
		 * focuses this directly - ref-anchored, no DOM traversal.
		 */
		firstEntry?: HTMLButtonElement;
	}

	let { onInsert, label, firstEntry = $bindable() }: Props = $props();
</script>

<div class="palette" role="group" aria-label={label}>
	<span class="palette-title" aria-hidden="true">Add a block</span>
	<div class="palette-grid">
		{#each blockPaletteEntries as entry, index (entry.type)}
			<Button
				bind:ref={
					() => firstEntry,
					(node) => {
						// Only the FIRST entry owns the bindable handle (the focus-fallback
						// target); the others ignore the setter so the last button does not win.
						if (index === 0) firstEntry = node;
					}
				}
				class="palette-entry"
				aria-label={`Add a ${entry.label} block`}
				onclick={() => onInsert(entry.type)}
			>
				<span class="entry-label">{entry.label}</span>
				<span class="entry-description">{entry.description}</span>
			</Button>
		{/each}
	</div>
</div>

<style>
	.palette {
		margin-top: var(--space-4);
		padding: var(--space-3) var(--space-4);
		background: var(--color-stone);
		border: 1px dashed var(--color-ink-25);
		border-radius: var(--radius-sm);
	}

	.palette-title {
		display: block;
		margin-bottom: var(--space-2);
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-ink-65);
	}

	.palette-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		gap: var(--space-2);
	}

	/* Each entry is a stacked label + description; the description is muted so the
	   label leads. The button hierarchy (secondary outline) comes from Button. */
	.palette :global(.palette-entry) {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		text-align: left;
	}

	.entry-label {
		font-weight: 600;
	}

	.entry-description {
		font-size: var(--text-xs);
		font-weight: 400;
		color: var(--color-ink-65);
	}
</style>
