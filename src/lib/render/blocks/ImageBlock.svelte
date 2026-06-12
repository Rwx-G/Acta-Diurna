<script lang="ts">
	import type { ImageBlock } from '$lib/schema';

	// Images reference an uploaded asset by id; remote URLs are impossible by
	// schema (CSP, no phone-home). Upload storage and serving arrive in Epic 2,
	// so here the block renders a placeholder frame keyed by assetId carrying
	// the required alt text - the figure structure and accessibility contract
	// are in place; only the pixels are pending.
	let { block }: { block: ImageBlock } = $props();

	const shortId = $derived(block.assetId.slice(0, 8));
</script>

<figure class="image-block">
	<div class="frame" role="img" aria-label={block.alt} data-asset-id={block.assetId}>
		<svg class="frame-icon" viewBox="0 0 24 24" aria-hidden="true">
			<path
				fill="currentColor"
				d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 2v9.5l3.5-3.5 3 3L16 9l3 3.5V5H5Zm4 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"
			/>
		</svg>
		<p class="frame-note">Image pending upload</p>
		<p class="frame-id">asset {shortId}</p>
	</div>
	{#if block.caption}
		<figcaption>{block.caption}</figcaption>
	{/if}
</figure>

<style>
	.image-block {
		margin: 0;
	}

	.frame {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		aspect-ratio: 16 / 9;
		padding: var(--space-5);
		color: var(--report-text-muted);
		background: color-mix(in srgb, var(--report-text) 3%, var(--report-surface));
		border: 1px dashed var(--report-rule-strong);
		border-radius: var(--radius-md);
	}

	.frame-icon {
		width: 40px;
		height: 40px;
		opacity: 0.7;
	}

	.frame-note {
		margin: 0;
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		font-weight: 500;
	}

	.frame-id {
		margin: 0;
		font-family: var(--font-sans);
		font-size: var(--text-xs);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		opacity: 0.7;
	}

	figcaption {
		margin-top: var(--space-3);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		font-style: italic;
		color: var(--report-text-muted);
		text-align: center;
	}
</style>
