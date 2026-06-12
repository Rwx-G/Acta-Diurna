<script lang="ts">
	import type { BlockType, Scales, Section } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';
	import AudiencePicker from './AudiencePicker.svelte';
	import BlockEditor from './BlockEditor.svelte';
	import IssueList from './IssueList.svelte';
	import { moveItem, newBlock, type ErrorsByKey, type MatrixBlockOption } from './editor-state';

	interface Props {
		section: Section;
		sectionIndex: number;
		count: number;
		errors: ErrorsByKey;
		/** Document scales, threaded to the comparison-matrix block editor. */
		scales?: Scales;
		/** Comparison-matrix blocks in the document, for the set-membership editor. */
		matrixBlocks?: MatrixBlockOption[];
		onEdit: () => void;
		onRemove: () => void;
		onMove: (direction: -1 | 1) => void;
	}

	let {
		section = $bindable(),
		sectionIndex,
		count,
		errors,
		scales,
		matrixBlocks,
		onEdit,
		onRemove,
		onMove
	}: Props = $props();

	const sectionIssues = $derived(errors[`section:${section.id}`] ?? []);

	const BLOCK_TYPES: BlockType[] = [
		'text',
		'table',
		'chart',
		'kpi',
		'image',
		'comparison-matrix',
		'field-grid',
		'legend',
		'set-membership',
		'chip-cluster',
		'callout',
		'code',
		'card-grid',
		'list'
	];
</script>

<section class="section-card" aria-label={`Section: ${section.title}`}>
	<header>
		<input
			class="section-title"
			name={`section-title:${sectionIndex}`}
			value={section.title}
			oninput={(event) => {
				section.title = event.currentTarget.value;
				onEdit();
			}}
			aria-label="Section title"
		/>
		<div class="controls">
			<Button onclick={() => onMove(-1)} disabled={sectionIndex === 0} aria-label="Move section up">
				Up
			</Button>
			<Button
				onclick={() => onMove(1)}
				disabled={sectionIndex === count - 1}
				aria-label="Move section down"
			>
				Down
			</Button>
			<Button variant="ghost" onclick={onRemove} aria-label="Remove section">Remove</Button>
		</div>
	</header>

	<AudiencePicker bind:audiences={section.audiences} legend="Section audiences" {onEdit} />

	<IssueList issues={sectionIssues} variant="section" />

	{#each section.blocks as block, blockIndex (block.id)}
		<BlockEditor
			bind:block={section.blocks[blockIndex]}
			{sectionIndex}
			{blockIndex}
			count={section.blocks.length}
			issues={errors[`block:${block.id}`] ?? []}
			{scales}
			{matrixBlocks}
			{onEdit}
			onRemove={() => {
				section.blocks.splice(blockIndex, 1);
				onEdit();
			}}
			onMove={(direction) => {
				moveItem(section.blocks, blockIndex, direction);
				onEdit();
			}}
		/>
	{/each}

	<div class="add-block">
		{#each BLOCK_TYPES as type (type)}
			<Button
				onclick={() => {
					section.blocks.push(newBlock(type));
					onEdit();
				}}
			>
				Add {type}
			</Button>
		{/each}
	</div>
</section>

<style>
	.section-card {
		margin-bottom: var(--space-5);
		padding: var(--space-4) var(--space-5);
		background: var(--color-surface);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-md);
	}

	header {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin-bottom: var(--space-3);
	}

	.section-title {
		flex: 1;
		min-width: 0;
		padding: var(--space-2) var(--space-3);
		font: inherit;
		font-size: var(--text-lg);
		font-weight: 600;
		color: inherit;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
	}

	.section-title:hover,
	.section-title:focus {
		background: var(--color-stone);
		border-color: var(--color-ink-25);
	}

	.controls {
		display: flex;
		gap: var(--space-1);
	}

	.add-block {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-4);
	}
</style>
