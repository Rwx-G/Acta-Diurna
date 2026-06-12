<script lang="ts">
	import type { ChipClusterBlock, Scales } from '$lib/schema';
	import { resolveScaleRef } from '$lib/schema';
	import Badge from './Badge.svelte';
	import BlockPlaceholder from './BlockPlaceholder.svelte';

	// SSR-only, zero hydration (the renderer-purity boundary): a wrapped row of
	// status pills, each resolving its colour and label from the referenced
	// document scale via the shared Badge - the SAME resolution the legend and the
	// matrix pills use. Nothing is authored per chip on the block; colour is never
	// the sole signal (the Badge always carries the entry label, NFR14). This
	// component ships no client JS, so the reader budget (NFR3) is unaffected.
	let {
		block,
		scales,
		theme = 'default'
	}: { block: ChipClusterBlock; scales?: Scales; theme?: string } = $props();

	const scale = $derived(resolveScaleRef(scales, block.scaleRef));
</script>

{#if !scale}
	<BlockPlaceholder message="This chip cluster references a scale that is not declared." />
{:else}
	<div class="chip-cluster">
		{#if block.title}
			<p class="cluster-title">{block.title}</p>
		{/if}
		<ul class="chips">
			{#each block.entries as entryKey, index (index)}
				<li class="chip">
					<Badge {scale} {entryKey} {theme} />
				</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	.chip-cluster {
		font-family: var(--font-sans);
	}

	.cluster-title {
		margin: 0 0 var(--space-3);
		font-size: var(--text-sm);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--report-heading);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.chip {
		display: inline-flex;
	}
</style>
