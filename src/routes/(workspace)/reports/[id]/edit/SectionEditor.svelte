<script lang="ts">
	import type { BlockType, Section } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';
	import AudiencePicker from './AudiencePicker.svelte';
	import BlockEditor from './BlockEditor.svelte';
	import { moveItem, newBlock, type ErrorsByKey } from './editor-state';

	interface Props {
		section: Section;
		sectionIndex: number;
		count: number;
		errors: ErrorsByKey;
		onEdit: () => void;
		onRemove: () => void;
		onMove: (direction: -1 | 1) => void;
	}

	let {
		section = $bindable(),
		sectionIndex,
		count,
		errors,
		onEdit,
		onRemove,
		onMove
	}: Props = $props();

	const sectionIssues = $derived(errors[`section:${section.id}`] ?? []);

	const BLOCK_TYPES: BlockType[] = ['text', 'table', 'chart', 'kpi', 'image'];
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
			<Button variant="danger" onclick={onRemove} aria-label="Remove section">Remove</Button>
		</div>
	</header>

	<AudiencePicker bind:audiences={section.audiences} legend="Section audiences" {onEdit} />

	{#if sectionIssues.length > 0}
		<ul class="section-issues" role="alert">
			{#each sectionIssues as issue (issue.path + issue.message)}
				<li>
					<strong>{issue.message}</strong>
					{#if issue.hint}<span class="hint">{issue.hint}</span>{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#each section.blocks as block, blockIndex (block.id)}
		<BlockEditor
			bind:block={section.blocks[blockIndex]}
			{sectionIndex}
			{blockIndex}
			count={section.blocks.length}
			issues={errors[`block:${block.id}`] ?? []}
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
		padding: var(--space-1) var(--space-2);
		font: inherit;
		font-size: 16px;
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

	.section-issues {
		margin: 0 0 var(--space-3);
		padding: var(--space-2) var(--space-5);
		color: var(--color-danger);
		background: var(--color-danger-08);
		border-radius: var(--radius-sm);
	}

	.section-issues .hint {
		display: block;
		color: var(--color-ink-65);
	}

	.add-block {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}
</style>
