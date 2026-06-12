<script lang="ts">
	import type { SkeletonSection } from '$lib/bricks';
	import Button from '$lib/ui/Button.svelte';
	import IssueList from '../../reports/[id]/edit/IssueList.svelte';
	import { moveItem, removeSection, type ErrorsByKey } from './compose-state';

	// Center zone of the three-zone composer (UX Flow A): the assembled structure
	// as an ordered list of sections and their blocks. Reorder up/down, rename a
	// section inline, remove a section or block. Block content is summarised, not
	// edited here - the composer is structure-first; per-block authoring happens in
	// the 1.5 report editor once a report is created from the skeleton (2.2).
	// Inline validation reuses the 1.5 IssueList at the offending element.
	interface Props {
		sections: SkeletonSection[];
		errors: ErrorsByKey;
		onChange: () => void;
	}

	let { sections = $bindable(), errors, onChange }: Props = $props();

	function blockSummary(block: SkeletonSection['blocks'][number]): string {
		const label = block.type.charAt(0).toUpperCase() + block.type.slice(1);
		switch (block.type) {
			case 'text': {
				const count = block.paragraphs.length;
				return `${label} - ${count} paragraph${count === 1 ? '' : 's'}`;
			}
			case 'image':
				return label;
			case 'table':
			case 'chart':
			case 'kpi': {
				const fields = block.binding?.fields.map((field) => field.name).join(', ');
				return fields ? `${label} - expects ${fields}` : label;
			}
			case 'comparison-matrix': {
				const count = block.findings.length;
				return `Comparison matrix - ${count} finding${count === 1 ? '' : 's'}`;
			}
			case 'field-grid': {
				const count = block.items.length;
				return `Field grid - ${count} field${count === 1 ? '' : 's'}`;
			}
			case 'legend':
				return `Legend - ${block.scaleRef || 'no scale'}`;
			case 'set-membership':
				return `Set membership - ${block.sourceBlockId ? 'from matrix' : 'no matrix'}`;
			default: {
				// A new block type must add a case above rather than fall through silently.
				const exhaustive: never = block;
				return exhaustive;
			}
		}
	}
</script>

<div class="structure" aria-label="Skeleton structure">
	{#each sections as section, sectionIndex (section.id)}
		<section class="section-card" aria-label={`Section: ${section.title}`}>
			<header>
				<input
					class="section-title"
					value={section.title}
					oninput={(event) => {
						section.title = event.currentTarget.value;
						onChange();
					}}
					aria-label="Section title"
				/>
				{#if section.annex}<span class="annex-tag">annex</span>{/if}
				<div class="controls">
					<Button
						onclick={() => {
							moveItem(sections, sectionIndex, -1);
							onChange();
						}}
						disabled={sectionIndex === 0}
						aria-label="Move section up">Up</Button
					>
					<Button
						onclick={() => {
							moveItem(sections, sectionIndex, 1);
							onChange();
						}}
						disabled={sectionIndex === sections.length - 1}
						aria-label="Move section down">Down</Button
					>
					<Button
						variant="ghost"
						onclick={() => {
							removeSection(sections, sectionIndex);
							onChange();
						}}
						aria-label="Remove section">Remove</Button
					>
				</div>
			</header>

			<IssueList issues={errors[`section:${section.id}`] ?? []} variant="section" />

			<ul class="blocks">
				{#each section.blocks as block, blockIndex (block.id)}
					<li class="block-row">
						<span class="block-summary">{blockSummary(block)}</span>
						<div class="controls">
							<Button
								onclick={() => {
									moveItem(section.blocks, blockIndex, -1);
									onChange();
								}}
								disabled={blockIndex === 0}
								aria-label="Move block up">Up</Button
							>
							<Button
								onclick={() => {
									moveItem(section.blocks, blockIndex, 1);
									onChange();
								}}
								disabled={blockIndex === section.blocks.length - 1}
								aria-label="Move block down">Down</Button
							>
							<Button
								variant="ghost"
								onclick={() => {
									section.blocks.splice(blockIndex, 1);
									onChange();
								}}
								aria-label="Remove block">Remove</Button
							>
						</div>
						<IssueList issues={errors[`block:${block.id}`] ?? []} variant="block" showField />
					</li>
				{/each}
			</ul>
		</section>
	{/each}
</div>

<style>
	.structure {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.section-card {
		padding: var(--space-3) var(--space-4);
		background: var(--color-surface);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-md);
	}

	header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
	}

	.section-title {
		flex: 1;
		min-width: 0;
		padding: var(--space-1) var(--space-2);
		font: inherit;
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

	.annex-tag {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-purple);
	}

	.controls {
		display: flex;
		gap: var(--space-1);
	}

	.blocks {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.block-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--color-stone);
		border-radius: var(--radius-sm);
	}

	.block-summary {
		flex: 1;
		min-width: 0;
		font-size: var(--text-sm);
		color: var(--color-ink-65);
	}
</style>
