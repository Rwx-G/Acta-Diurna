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
	placeholder="e.g. 0190c0de-0000-7000-8000-000000000000"
	aria-describedby={`image-asset-note-${block.id}`}
	oninput={(event) => {
		block.assetId = event.currentTarget.value;
		onEdit();
	}}
/>
<p id={`image-asset-note-${block.id}`} class="note">
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
	/* `.field-label` and the input base reset live in the workspace-scoped
	   form-fields.css (under `.block-card`); only the full-width override remains. */
	input {
		display: block;
		width: 100%;
	}

	.note {
		margin: var(--space-2) 0 0;
		font-size: var(--text-sm);
		color: var(--color-ink-65);
	}
</style>
