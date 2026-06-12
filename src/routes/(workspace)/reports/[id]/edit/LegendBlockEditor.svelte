<script lang="ts">
	import type { LegendBlock, Scales } from '$lib/schema';

	// The legend renders the WHOLE referenced scale: the author picks which scale,
	// not which entries. The colour and labels come from the scale, so this editor
	// only chooses the `scaleRef` and an optional `title`. The `scales` prop is the
	// document's scales, threaded down so the select offers the declared scales.
	// The shared BlockEditor frame supplies the audience picker.
	interface Props {
		block: LegendBlock;
		scales?: Scales;
		onEdit: () => void;
	}

	let { block = $bindable(), scales, onEdit }: Props = $props();

	const scaleOptions = $derived(scales ?? []);
</script>

<div class="legend-editor">
	<label>
		Scale
		<select
			value={block.scaleRef}
			onchange={(event) => {
				block.scaleRef = event.currentTarget.value;
				onEdit();
			}}
			aria-label="Legend scale"
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
			placeholder="Legend heading"
			oninput={(event) => {
				const value = event.currentTarget.value;
				if (value === '') delete block.title;
				else block.title = value;
				onEdit();
			}}
			aria-label="Legend title"
		/>
	</label>

	{#if scaleOptions.length === 0}
		<p class="hint">
			No document scales declared yet. Add a scale to the document to populate the select.
		</p>
	{/if}
</div>

<style>
	.legend-editor {
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

	input,
	select {
		padding: var(--space-2) var(--space-3);
		font: inherit;
		font-weight: 400;
		color: inherit;
		background: var(--color-surface);
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
	}

	.hint {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-ink-65);
	}
</style>
