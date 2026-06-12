<script lang="ts">
	import type { Scale } from '$lib/schema';
	import { resolveEntryRef } from '$lib/schema';
	import { scaleEntryColor } from '../theme/scales.ts';

	// The shared status pill (Epic 7, Story 7.5): renders ONE scale entry as a
	// coloured pill carrying the entry's label - the same colour and label
	// resolution the legend and the comparison-matrix severity pill use. Reused by
	// the chip-cluster block and the table scaleRef column, so the badge look is
	// consistent across every Phase B status surface.
	//
	// AAA: the entry's label text is ALWAYS rendered, so colour is never the sole
	// signal (NFR14). The label is Svelte text interpolation (no {@html}), so an
	// HTML-looking entry label renders as inert text. SSR-only, zero hydration: no
	// client JS, the reader budget (NFR3) is unaffected.
	//
	// An entryKey that resolves to no scale entry (cannot happen on the reader path
	// post-validation; possible mid-edit in the workspace preview) falls back to
	// the raw key as the label and slot 0 for a stable colour, so the preview never
	// blanks.
	let {
		scale,
		entryKey,
		theme = 'default'
	}: { scale: Scale; entryKey: string; theme?: string } = $props();

	const index = $derived(scale.entries.findIndex((entry) => entry.key === entryKey));
	const label = $derived(resolveEntryRef(scale, entryKey)?.label ?? entryKey);
	const color = $derived(scaleEntryColor(scale, index === -1 ? 0 : index, theme));
</script>

<span class="badge" style="--badge-color: {color}">{label}</span>

<style>
	.badge {
		display: inline-block;
		padding: 2px var(--space-2);
		border-radius: var(--radius-pill);
		font-family: var(--font-sans);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--report-bg);
		background: var(--badge-color);
		white-space: nowrap;
	}
</style>
