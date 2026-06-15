<script lang="ts">
	import type { Scales, TimelineBlock } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';
	import MilestoneRow from './MilestoneRow.svelte';
	import { moveItem } from './editor-state';

	// The timeline adds, edits and removes ordered milestones. Each milestone
	// carries a `label`, an optional `date`/phase sub-label, an optional rich-text
	// `detail` (edited as inline RUNS through the shared ParagraphsEditor, Story 10.4
	// - the SAME run-level editor the text, callout and list blocks use, so the
	// detail's bold / italic / inline-code / link marks are editable in place, no
	// flatten-on-edit and no freeform HTML), and a `status` ({ scaleRef, entry })
	// picked from the document scales: the scale select offers the declared scales,
	// the entry select offers that scale's entries by key (label shown). The `scales`
	// prop is the document's scales, threaded down so the selects offer the declared
	// scales. Each milestone row is its own child component (MilestoneRow) so the
	// entry-option lookup (`resolveScaleRef`) memoizes per milestone via `$derived`
	// and re-runs only on a scaleRef/scales change, not on every label/date keystroke.
	// The shared BlockEditor frame supplies the audience picker.
	interface Props {
		block: TimelineBlock;
		scales?: Scales;
		onEdit: () => void;
	}

	let { block = $bindable(), scales, onEdit }: Props = $props();

	const scaleOptions = $derived(scales ?? []);
</script>

<div class="timeline-editor">
	<label>
		Title (optional)
		<input
			value={block.title ?? ''}
			placeholder="Timeline heading"
			oninput={(event) => {
				const value = event.currentTarget.value;
				if (value === '') delete block.title;
				else block.title = value;
				onEdit();
			}}
			aria-label="Timeline title"
		/>
	</label>

	<!-- Keyed by the milestone OBJECT REFERENCE, not the index: `moveItem` reorders by
	     an in-place adjacent swap that preserves object identity, so a reorder reuses the
	     existing milestone subtrees (focus survives the move) instead of remounting every
	     row whose index shifted. -->
	{#each block.milestones as milestone, milestoneIndex (milestone)}
		<MilestoneRow
			bind:milestone={block.milestones[milestoneIndex]}
			{milestoneIndex}
			{scales}
			{scaleOptions}
			canMoveUp={milestoneIndex > 0}
			canMoveDown={milestoneIndex < block.milestones.length - 1}
			canRemove={block.milestones.length > 1}
			onMoveUp={() => {
				moveItem(block.milestones, milestoneIndex, -1);
				onEdit();
			}}
			onMoveDown={() => {
				moveItem(block.milestones, milestoneIndex, 1);
				onEdit();
			}}
			onRemove={() => {
				block.milestones.splice(milestoneIndex, 1);
				onEdit();
			}}
			{onEdit}
		/>
	{/each}

	<Button
		onclick={() => {
			block.milestones.push({ label: '', status: { scaleRef: '', entry: '' } });
			onEdit();
		}}
	>
		Add milestone
	</Button>

	{#if scaleOptions.length === 0}
		<p class="hint">
			No document scales declared yet. Add a scale to the document to populate the status selects.
		</p>
	{/if}
</div>

<style>
	.timeline-editor {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	label {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-ink-65);
	}

	/* The `input, select` reset is the shared workspace base (form-fields.css). */

	.hint {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-ink-65);
	}
</style>
