<script lang="ts">
	import type { Block } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';
	import AudiencePicker from './AudiencePicker.svelte';
	import ChartBlockEditor from './ChartBlockEditor.svelte';
	import ImageBlockEditor from './ImageBlockEditor.svelte';
	import IssueList from './IssueList.svelte';
	import KpiBlockEditor from './KpiBlockEditor.svelte';
	import TableBlockEditor from './TableBlockEditor.svelte';
	import TextBlockEditor from './TextBlockEditor.svelte';
	import type { EditorIssue } from './editor-state';

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
			<Button variant="danger" onclick={onRemove} aria-label="Remove block">Remove</Button>
		</div>
	</header>

	<IssueList {issues} variant="block" showField />

	<AudiencePicker bind:audiences={block.audiences} legend="Block audiences" {onEdit} />

	{#if block.type === 'text'}
		<TextBlockEditor bind:block {sectionIndex} {blockIndex} {onEdit} />
	{:else if block.type === 'table'}
		<TableBlockEditor bind:block {onEdit} />
	{:else if block.type === 'chart'}
		<ChartBlockEditor bind:block {onEdit} />
	{:else if block.type === 'kpi'}
		<KpiBlockEditor bind:block {onEdit} />
	{:else if block.type === 'image'}
		<ImageBlockEditor bind:block {onEdit} />
	{/if}
</article>

<style>
	.block-card {
		margin-bottom: var(--space-3);
		padding: var(--space-3) var(--space-4);
		background: var(--color-stone);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-sm);
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-2);
	}

	.block-type {
		font-size: 12px;
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
