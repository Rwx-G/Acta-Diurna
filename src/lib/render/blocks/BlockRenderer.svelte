<script lang="ts">
	import type { ComparisonMatrixBlock as ComparisonMatrixBlockType, Scales } from '$lib/schema';
	import type { BlockView } from '../document-view.ts';
	import CalloutBlock from './CalloutBlock.svelte';
	import CardGridBlock from './CardGridBlock.svelte';
	import ChartBlock from './ChartBlock.svelte';
	import ChipClusterBlock from './ChipClusterBlock.svelte';
	import CodeBlock from './CodeBlock.svelte';
	import ComparisonMatrixBlock from './ComparisonMatrixBlock.svelte';
	import FieldGridBlock from './FieldGridBlock.svelte';
	import ImageBlock from './ImageBlock.svelte';
	import KpiBlock from './KpiBlock.svelte';
	import LegendBlock from './LegendBlock.svelte';
	import ListBlock from './ListBlock.svelte';
	import SetMembershipBlock from './SetMembershipBlock.svelte';
	import TableBlock from './TableBlock.svelte';
	import TextBlock from './TextBlock.svelte';

	// Dispatches a block view to its renderer. An invalid block (preview path
	// only - the reader always gets a validated document) renders a gentle
	// in-place notice instead of throwing, so one in-progress block never blanks
	// the whole preview. `scales`/`theme` are threaded for the comparison-matrix
	// block, which resolves its colours from the document scales (Epic 7).
	let {
		view,
		scales,
		matrixBlocks,
		theme
	}: {
		view: BlockView;
		scales?: Scales;
		matrixBlocks?: Map<string, ComparisonMatrixBlockType>;
		theme?: string;
	} = $props();
</script>

<div class="block" id={view.anchorId}>
	{#if view.block === null}
		<p class="invalid" role="status">
			{view.invalidNotice ?? 'This block is not valid yet. Fix it in the editor.'}
		</p>
	{:else if view.block.type === 'text'}
		<TextBlock block={view.block} />
	{:else if view.block.type === 'table'}
		<TableBlock block={view.block} {scales} {theme} />
	{:else if view.block.type === 'chart'}
		<ChartBlock block={view.block} />
	{:else if view.block.type === 'kpi'}
		<KpiBlock block={view.block} />
	{:else if view.block.type === 'image'}
		<ImageBlock block={view.block} />
	{:else if view.block.type === 'comparison-matrix'}
		<ComparisonMatrixBlock block={view.block} {scales} {theme} />
	{:else if view.block.type === 'field-grid'}
		<FieldGridBlock block={view.block} />
	{:else if view.block.type === 'legend'}
		<LegendBlock block={view.block} {scales} {theme} />
	{:else if view.block.type === 'chip-cluster'}
		<ChipClusterBlock block={view.block} {scales} {theme} />
	{:else if view.block.type === 'callout'}
		<CalloutBlock block={view.block} />
	{:else if view.block.type === 'code'}
		<CodeBlock block={view.block} />
	{:else if view.block.type === 'set-membership'}
		<SetMembershipBlock
			block={view.block}
			matrix={matrixBlocks?.get(view.block.sourceBlockId)}
			{scales}
			{theme}
		/>
	{:else if view.block.type === 'card-grid'}
		<CardGridBlock block={view.block} />
	{:else if view.block.type === 'list'}
		<ListBlock block={view.block} />
	{/if}
</div>

<style>
	.block {
		margin: 0 0 var(--space-6);
		scroll-margin-top: var(--space-6);
	}

	.block:last-child {
		margin-bottom: 0;
	}

	.invalid {
		margin: 0;
		padding: var(--space-3) var(--space-4);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		color: var(--color-amber);
		background: var(--color-amber-12);
		border: 1px solid color-mix(in srgb, var(--color-amber) 30%, transparent);
		border-radius: var(--radius-sm);
	}
</style>
