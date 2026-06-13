<script lang="ts">
	import type {
		BlockType,
		ComparisonMatrixBlock as ComparisonMatrixBlockType,
		Scales
	} from '$lib/schema';
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
	import TimelineBlock from './TimelineBlock.svelte';

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

	// Exhaustiveness guard for the `{#if block.type === ...}` dispatch below. The
	// template chain cannot itself be exhaustiveness-checked by svelte-check, so
	// this `satisfies Record<BlockType, true>` is the compile-time backstop: a new
	// block type missing a branch here is a compile error. Every key listed must
	// have a matching `{:else if}` arm; the terminal `{:else}` only catches a
	// forward-version block the validator let through, never a forgotten v1 type.
	// Keep this set in lockstep with the dispatch arms.
	const HANDLED_BLOCK_TYPES = {
		text: true,
		table: true,
		chart: true,
		kpi: true,
		image: true,
		'comparison-matrix': true,
		'field-grid': true,
		legend: true,
		'chip-cluster': true,
		callout: true,
		code: true,
		'set-membership': true,
		'card-grid': true,
		list: true,
		timeline: true
	} satisfies Record<BlockType, true>;
	void HANDLED_BLOCK_TYPES;
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
	{:else if view.block.type === 'timeline'}
		<TimelineBlock block={view.block} {scales} {theme} />
	{:else}
		<!-- A validated-but-unhandled block (a forward-version type the validator let
		through). Render the same neutral notice as the invalid path rather than
		blanking. The HANDLED_BLOCK_TYPES guard above makes a forgotten v1 type a
		compile error, so this only fires for a future schema version. -->
		<p class="invalid" role="status">
			{view.invalidNotice ?? 'This block is not valid yet. Fix it in the editor.'}
		</p>
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
