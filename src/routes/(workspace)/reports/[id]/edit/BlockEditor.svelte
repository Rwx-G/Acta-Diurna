<script lang="ts">
	import type { Block, Scales } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';
	import AudiencePicker from './AudiencePicker.svelte';
	import ChartBlockEditor from './ChartBlockEditor.svelte';
	import ChipClusterBlockEditor from './ChipClusterBlockEditor.svelte';
	import ComparisonMatrixBlockEditor from './ComparisonMatrixBlockEditor.svelte';
	import FieldGridBlockEditor from './FieldGridBlockEditor.svelte';
	import ImageBlockEditor from './ImageBlockEditor.svelte';
	import IssueList from './IssueList.svelte';
	import KpiBlockEditor from './KpiBlockEditor.svelte';
	import LegendBlockEditor from './LegendBlockEditor.svelte';
	import SetMembershipBlockEditor from './SetMembershipBlockEditor.svelte';
	import TableBlockEditor from './TableBlockEditor.svelte';
	import TextBlockEditor from './TextBlockEditor.svelte';
	import type { EditorIssue, MatrixBlockOption } from './editor-state';

	// Thin dispatcher: owns the shared block chrome (header controls, inline
	// issue list, audience picker) and delegates the type-specific body to one
	// of the five per-type editors. The `{@const}` narrows the block union so
	// each child binds a precisely typed block (Svelte 5 ownership: a child that
	// mutates a prop needs that prop bound, not the whole block re-derived).
	interface Props {
		block: Block;
		sectionIndex: number;
		blockIndex: number;
		count: number;
		issues: EditorIssue[];
		/** Document scales, for the scale-referencing block editors (comparison-matrix, legend). */
		scales?: Scales;
		/** Comparison-matrix blocks in the document, for the set-membership block editor. */
		matrixBlocks?: MatrixBlockOption[];
		onEdit: () => void;
		onRemove: () => void;
		onMove: (direction: -1 | 1) => void;
	}

	let {
		block = $bindable(),
		sectionIndex,
		blockIndex,
		count,
		issues,
		scales,
		matrixBlocks,
		onEdit,
		onRemove,
		onMove
	}: Props = $props();
</script>

<article class="block-card" aria-label={`${block.type} block`}>
	<header>
		<span class="block-type">{block.type}</span>
		<div class="controls">
			<Button onclick={() => onMove(-1)} disabled={blockIndex === 0} aria-label="Move block up">
				Up
			</Button>
			<Button
				onclick={() => onMove(1)}
				disabled={blockIndex === count - 1}
				aria-label="Move block down"
			>
				Down
			</Button>
			<Button variant="ghost" onclick={onRemove} aria-label="Remove block">Remove</Button>
		</div>
	</header>

	<IssueList {issues} variant="block" showField />

	<AudiencePicker bind:audiences={block.audiences} legend="Block audiences" {onEdit} />

	{#if block.type === 'text'}
		<TextBlockEditor bind:block {sectionIndex} {blockIndex} {onEdit} />
	{:else if block.type === 'table'}
		<TableBlockEditor bind:block {scales} {onEdit} />
	{:else if block.type === 'chart'}
		<ChartBlockEditor bind:block {onEdit} />
	{:else if block.type === 'kpi'}
		<KpiBlockEditor bind:block {onEdit} />
	{:else if block.type === 'image'}
		<ImageBlockEditor bind:block {onEdit} />
	{:else if block.type === 'comparison-matrix'}
		<ComparisonMatrixBlockEditor bind:block {scales} {onEdit} />
	{:else if block.type === 'field-grid'}
		<FieldGridBlockEditor bind:block {onEdit} />
	{:else if block.type === 'legend'}
		<LegendBlockEditor bind:block {scales} {onEdit} />
	{:else if block.type === 'set-membership'}
		<SetMembershipBlockEditor bind:block {matrixBlocks} {onEdit} />
	{:else if block.type === 'chip-cluster'}
		<ChipClusterBlockEditor bind:block {scales} {onEdit} />
	{/if}
</article>

<style>
	.block-card {
		margin-bottom: var(--space-4);
		padding: var(--space-4) var(--space-5);
		background: var(--color-stone);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-sm);
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-3);
	}

	.block-type {
		font-size: var(--text-sm);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-ink-65);
	}

	.controls {
		display: flex;
		gap: var(--space-1);
	}
</style>
