<script lang="ts">
	import type { ChipClusterBlock, Scales } from '$lib/schema';
	import { resolveScaleRef } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';
	import UiIcon from '$lib/ui/UiIcon.svelte';

	// The chip cluster renders one pill per listed entry of a single referenced
	// scale; colour and label come from the scale, so this editor only chooses the
	// `scaleRef`, an optional `title`, and the ordered list of entry keys. The
	// entry select offers the chosen scale's entries by key (label shown). The
	// `scales` prop is the document's scales, threaded down so the selects offer
	// the declared scales. The shared BlockEditor frame supplies the audience
	// picker.
	interface Props {
		block: ChipClusterBlock;
		scales?: Scales;
		onEdit: () => void;
	}

	let { block = $bindable(), scales, onEdit }: Props = $props();

	const scaleOptions = $derived(scales ?? []);
	const entryOptions = $derived(resolveScaleRef(scales, block.scaleRef)?.entries ?? []);
</script>

<div class="chip-cluster-editor">
	<label>
		Scale
		<select
			value={block.scaleRef}
			onchange={(event) => {
				block.scaleRef = event.currentTarget.value;
				onEdit();
			}}
			aria-label="Chip cluster scale"
		>
			<option value="">Select a scale</option>
			{#each scaleOptions as scale (scale.key)}
				<option value={scale.key}>{scale.label}</option>
			{/each}
		</select>
	</label>

	<label>
		Title (optional)
		<input
			value={block.title ?? ''}
			placeholder="Cluster heading"
			oninput={(event) => {
				const value = event.currentTarget.value;
				if (value === '') delete block.title;
				else block.title = value;
				onEdit();
			}}
			aria-label="Chip cluster title"
		/>
	</label>

	<p class="field-label">Chips</p>
	{#each block.entries as entryKey, entryIndex (entryIndex)}
		<div class="field-row">
			<select
				value={entryKey}
				onchange={(event) => {
					block.entries[entryIndex] = event.currentTarget.value;
					onEdit();
				}}
				aria-label={`Chip ${entryIndex + 1} entry`}
			>
				<option value="">Select an entry</option>
				{#each entryOptions as entry (entry.key)}
					<option value={entry.key}>{entry.label}</option>
				{/each}
			</select>
			<Button
				class="row-control"
				variant="icon-danger"
				onclick={() => {
					block.entries.splice(entryIndex, 1);
					onEdit();
				}}
				disabled={block.entries.length === 1}
				aria-label={`Remove chip ${entryIndex + 1}`}
			>
				<UiIcon name="x" />
			</Button>
		</div>
	{/each}
	<Button
		onclick={() => {
			block.entries.push('');
			onEdit();
		}}
	>
		Add chip
	</Button>

	{#if scaleOptions.length === 0}
		<p class="hint">
			No document scales declared yet. Add a scale to the document to populate the select.
		</p>
	{/if}
</div>

<style>
	.chip-cluster-editor {
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

	/* `.field-label`, `input` and `select` are the shared workspace base
	   (form-fields.css), authoritative - no local copy. */

	.field-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.field-row select {
		flex: 1 1 8rem;
		min-width: 0;
	}

	.hint {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-ink-65);
	}
</style>
