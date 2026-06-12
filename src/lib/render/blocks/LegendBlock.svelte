<script lang="ts">
	import type { LegendBlock, Scales } from '$lib/schema';
	import { resolveScaleRef } from '$lib/schema';
	import { scaleEntryColor } from '../theme/scales.ts';
	import BlockPlaceholder from './BlockPlaceholder.svelte';

	// SSR-only, zero hydration (the renderer-purity boundary): one swatch per entry
	// of the referenced document scale. Colour, label and optional sublabel derive
	// ENTIRELY from the scale (scaleEntryColor + the entry's own text) - nothing is
	// re-authored on the block, so the legend's colours MATCH the matrix's. Every
	// value is Svelte text interpolation (no {@html}). AAA: a swatch always carries
	// its text label, so colour is never the only signal (the chip is decorative,
	// aria-hidden). This component ships no client JS, so the reader budget (NFR3)
	// is unaffected.
	let {
		block,
		scales,
		theme = 'default'
	}: { block: LegendBlock; scales?: Scales; theme?: string } = $props();

	const scale = $derived(resolveScaleRef(scales, block.scaleRef));
</script>

{#if !scale}
	<BlockPlaceholder message="This legend references a scale that is not declared." />
{:else}
	<div class="legend">
		{#if block.title}
			<p class="legend-title">{block.title}</p>
		{/if}
		<ul class="entries">
			{#each scale.entries as entry, index (entry.key)}
				<li class="entry">
					<span
						class="swatch"
						aria-hidden="true"
						style="--swatch-color: {scaleEntryColor(scale, index, theme)}"
					></span>
					<span class="text">
						<span class="entry-label">{entry.label}</span>
						{#if entry.sublabel}<span class="entry-sublabel">{entry.sublabel}</span>{/if}
					</span>
				</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	.legend {
		font-family: var(--font-sans);
	}

	.legend-title {
		margin: 0 0 var(--space-3);
		font-size: var(--text-sm);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--report-heading);
	}

	.entries {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-5);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.entry {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
	}

	.swatch {
		flex: 0 0 auto;
		width: 0.85rem;
		height: 0.85rem;
		margin-top: 0.15rem;
		border-radius: var(--radius-sm);
		background: var(--swatch-color);
	}

	.text {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.entry-label {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--report-text);
	}

	.entry-sublabel {
		font-size: var(--text-xs);
		color: var(--report-text-muted);
	}
</style>
