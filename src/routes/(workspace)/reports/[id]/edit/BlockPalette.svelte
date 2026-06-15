<script lang="ts">
	import type { BlockType } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';
	import { blockPaletteGroups } from './editor-state';

	// The block palette (Story 10.2, recomposed for the UX redesign): a "+ Ajouter un
	// bloc" disclosure that opens a CATEGORIZED popover (Texte / Donnees / Mise en page
	// / Media) instead of an always-expanded flat list of 15 entries. Picking an entry
	// inserts a default-shaped block of that type via the caller's `onInsert` (which
	// calls `newBlock`). The catalogue stays EXHAUSTIVE over `BlockType` at compile time
	// (`blockPaletteGroups` derives from the exhaustive `satisfies Record<BlockType>`
	// catalogue), so a new block type can never be silently missing; the palette adds NO
	// new block type, it only exposes the existing catalogue, now chunked.
	//
	// Accessibility: the popover is a labelled group (NFR15) so a screen reader announces
	// "Add a block to <section>" before the choices; each button carries an explicit
	// `aria-label` ("Add a <label> block") and a visible one-line description. The
	// disclosure button drives `aria-expanded`/`aria-controls`, the popover is
	// Escape-dismissible (WCAG 1.4.13), and opening it moves focus to the first entry so
	// keyboard users land inside the choices. Insertion focus management (where the new
	// block's DOM node lands) is the CALLER's concern; the palette only reports the type.
	interface Props {
		onInsert: (type: BlockType) => void;
		/** Labels the group so multiple palettes (one per section) read distinctly. */
		label: string;
		/**
		 * Bindable handle to the palette's FIRST entry button, for the caller's
		 * empty-section focus fallback (Story 10.2, NFR15): when a delete empties the
		 * block list there is no block card left to land focus on, so `SectionEditor`
		 * opens the palette and focuses this directly - ref-anchored, no DOM traversal.
		 */
		firstEntry?: HTMLButtonElement;
		/** Bindable open state, so the caller can open the menu for the empty-section focus path. */
		open?: boolean;
	}

	let { onInsert, label, firstEntry = $bindable(), open = $bindable(false) }: Props = $props();

	let toggleButton = $state<HTMLButtonElement>();

	function choose(type: BlockType): void {
		onInsert(type);
		open = false;
	}

	// Escape dismisses the open popover (WCAG 1.4.13) and returns focus to the toggle.
	// Bound at the window so it works wherever focus sits inside the popover, without
	// putting a keyboard handler on the non-interactive group container.
	function onWindowKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && open) {
			open = false;
			toggleButton?.focus();
		}
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div class="add-block">
	<Button
		bind:ref={toggleButton}
		class="add-block-toggle"
		aria-expanded={open}
		aria-haspopup="true"
		onclick={() => (open = !open)}
	>
		+ Ajouter un bloc
	</Button>
	{#if open}
		<div class="palette" role="group" aria-label={label}>
			{#each blockPaletteGroups as group, groupIndex (group.category)}
				<div class="palette-category">
					<span class="category-label" aria-hidden="true">{group.label}</span>
					<div class="palette-grid">
						{#each group.entries as entry, entryIndex (entry.type)}
							<Button
								bind:ref={
									() => firstEntry,
									(node) => {
										// Only the FIRST entry of the FIRST group owns the bindable handle
										// (the focus-fallback target); the others ignore the setter.
										if (groupIndex === 0 && entryIndex === 0) firstEntry = node;
									}
								}
								class="palette-entry"
								aria-label={`Add a ${entry.label} block`}
								onclick={() => choose(entry.type)}
							>
								<span class="entry-label">{entry.label}</span>
								<span class="entry-description">{entry.description}</span>
							</Button>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.add-block {
		position: relative;
		margin-top: var(--space-4);
	}

	.palette {
		margin-top: var(--space-2);
		padding: var(--space-3) var(--space-4);
		background: var(--color-surface);
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-md);
		box-shadow: 0 6px 24px rgb(28 27 46 / 12%);
	}

	.palette-category {
		margin-bottom: var(--space-3);
	}

	.palette-category:last-child {
		margin-bottom: 0;
	}

	.category-label {
		display: block;
		margin-bottom: var(--space-2);
		font-size: var(--text-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
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
