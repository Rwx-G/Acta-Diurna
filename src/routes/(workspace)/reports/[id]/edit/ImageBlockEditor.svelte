<script lang="ts">
	import type { ImageBlock } from '$lib/schema';

	interface Props {
		block: ImageBlock;
		onEdit: () => void;
	}

	let { block = $bindable(), onEdit }: Props = $props();
</script>

<label class="field-label" for={`image-asset-${block.id}`}>Asset</label>
<input id={`image-asset-${block.id}`} value={block.assetId} disabled placeholder="Asset UUID" />
<p class="note">Uploads arrive with data injection (Epic 2); an existing asset id is kept.</p>
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

	input:disabled {
		color: var(--color-ink-65);
		background: var(--color-ink-12);
	}

	.note {
		margin: var(--space-2) 0 0;
		font-size: var(--text-sm);
		color: var(--color-ink-65);
	}
</style>
