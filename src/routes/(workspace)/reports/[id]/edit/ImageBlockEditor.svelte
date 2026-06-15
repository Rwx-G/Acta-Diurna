<script lang="ts">
	import type { ImageBlock } from '$lib/schema';

	interface Props {
		block: ImageBlock;
		onEdit: () => void;
	}

	let { block = $bindable(), onEdit }: Props = $props();
</script>

<label class="field-label" for={`image-asset-${block.id}`}>Asset reference</label>
<input
	id={`image-asset-${block.id}`}
	value={block.assetId}
	placeholder="Asset UUID"
	oninput={(event) => {
		block.assetId = event.currentTarget.value;
		onEdit();
	}}
/>
<p class="note">
	Point at an uploaded asset (Epic 2 ingestion); paste its UUID. This editor edits the existing
	reference, not a new upload.
</p>
<label class="field-label" for={`image-alt-${block.id}`}>Alt text (required)</label>
<input
	id={`image-alt-${block.id}`}
	value={block.alt}
	oninput={(event) => {
		block.alt = event.currentTarget.value;
		onEdit();
	}}
/>
<label class="field-label" for={`image-caption-${block.id}`}>Caption (optional)</label>
<input
	id={`image-caption-${block.id}`}
	value={block.caption ?? ''}
	oninput={(event) => {
		const value = event.currentTarget.value;
		if (value === '') delete block.caption;
		else block.caption = value;
		onEdit();
	}}
/>

<style>
	.field-label {
		display: block;
		margin: var(--space-4) 0 var(--space-2);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-ink-65);
	}

	input {
		display: block;
		width: 100%;
		padding: var(--space-2) var(--space-3);
		font: inherit;
		color: inherit;
		background: var(--color-surface);
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
	}

	.note {
		margin: var(--space-2) 0 0;
		font-size: var(--text-sm);
		color: var(--color-ink-65);
	}
</style>
