<script lang="ts">
	import type { SeriesDiff, BlockDiff, ChangeVerdict } from '$lib/schema';
	import type { SeriesDiffBaseline } from '$lib/server/documents/reports';
	import { formatUtcDateTime } from '$lib/format';
	import EmptyState from '$lib/ui/EmptyState.svelte';

	// The author-facing "what changed since last issue" changelog (Story 9.3). It
	// renders the typed SeriesDiff straight from the engine: a computed `diff` (the
	// per-section, per-block verdicts) or one of two neutral states. It NEVER reads a
	// speaker note or a prior-issue block body - the engine hands it only CHANGE
	// FLAGS plus ids, titles, and types, and that is all this component renders.
	interface Props {
		diff: SeriesDiff;
		baseline: SeriesDiffBaseline | null;
	}

	let { diff, baseline }: Props = $props();

	// The comparison baseline label: the predecessor's cosmetic display identity
	// (its author-set issue label, falling back to its title) and its publish date.
	const baselineLabel = $derived(baseline ? (baseline.issueLabel ?? baseline.title) : null);
	const baselineDate = $derived(
		baseline?.publishedAt ? formatUtcDateTime(baseline.publishedAt) : null
	);

	// A verdict tag carries its display label AND its CSS tone together, so the
	// template never re-derives the tone from the label (a copy/i18n change to a
	// label would otherwise silently break styling). The tone is mapped DIRECTLY from
	// the engine's `ChangeVerdict` and the data/content flags, never from the string.
	type Tone = 'added' | 'removed' | 'moved' | 'kept' | 'changed';
	interface VerdictTag {
		label: string;
		tone: Tone;
	}

	const STRUCTURAL_VERDICT: Record<ChangeVerdict, VerdictTag> = {
		added: { label: 'Added', tone: 'added' },
		removed: { label: 'Removed', tone: 'removed' },
		moved: { label: 'Moved', tone: 'moved' },
		kept: { label: 'Unchanged', tone: 'kept' }
	};

	const DATA_CHANGED: VerdictTag = { label: 'Data changed', tone: 'changed' };
	const CONTENT_CHANGED: VerdictTag = { label: 'Content changed', tone: 'changed' };

	// Every applicable verdict for a block, not just the first (AC2): a moved block
	// whose data also changed shows both. A `kept`/`moved` block with no data or
	// content change keeps its structural tag alone, so an unchanged block reads as
	// "Unchanged" rather than vanishing.
	function verdicts(block: BlockDiff): VerdictTag[] {
		const tags: VerdictTag[] = [STRUCTURAL_VERDICT[block.change]];
		if (block.dataChanged) tags.push(DATA_CHANGED);
		if (block.contentChanged) tags.push(CONTENT_CHANGED);
		return tags;
	}
</script>

{#if diff.kind === 'no-predecessor'}
	{#if diff.reason === 'first-issue'}
		<EmptyState
			title="This is the first issue of the series"
			description="There is no previous issue to compare against yet. Once you start the next issue from this one and publish it, this view will show what changed."
		/>
	{:else}
		<EmptyState
			title="The previous issue is not published yet"
			description="This issue has a predecessor in the series, but it has no published edition to compare against. Publish the previous issue, then come back to see what changed."
		/>
	{/if}
{:else if diff.kind === 'substantial-drift'}
	<EmptyState
		title="Structure changed too much to compare block by block"
		description="This issue differs substantially from the previous one - they share almost no blocks - so a detailed, block-by-block diff would mislead rather than help."
	/>
{:else}
	<section class="changelog" aria-label="What changed since the previous issue">
		{#if baselineLabel}
			<p class="baseline" data-testid="baseline">
				Compared against <strong>{baselineLabel}</strong>{#if baselineDate}, published {baselineDate}{/if}.
			</p>
		{/if}

		{#each diff.sections as section (section.id)}
			<article class="section" data-section-change={section.change}>
				<header class="section-head">
					<h2>{section.title}</h2>
					<span class="tag {STRUCTURAL_VERDICT[section.change].tone}">
						{STRUCTURAL_VERDICT[section.change].label}
					</span>
				</header>

				{#if section.blocks.length === 0}
					<p class="no-blocks">No blocks in this section.</p>
				{:else}
					<ul class="blocks">
						{#each section.blocks as block (block.id)}
							<li class="block" data-block-change={block.change}>
								<span class="block-type">{block.type}</span>
								<span class="block-id">{block.id}</span>
								<span class="tags">
									{#each verdicts(block) as tag (tag.label)}
										<span class="tag {tag.tone}">{tag.label}</span>
									{/each}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</article>
		{/each}
	</section>
{/if}

<style>
	.changelog {
		max-width: var(--content-width);
		margin: 0 auto;
	}

	.baseline {
		margin: 0 0 var(--space-5);
		color: var(--color-ink-65);
	}

	.section {
		margin-bottom: var(--space-6);
		padding-bottom: var(--space-4);
		border-bottom: 1px solid var(--color-ink-12);
	}

	.section-head {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		margin-bottom: var(--space-3);
	}

	.section-head h2 {
		margin: 0;
		font-size: var(--text-lg);
		font-weight: 600;
	}

	.no-blocks {
		margin: 0;
		color: var(--color-ink-65);
	}

	.blocks {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.block {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-sm);
	}

	.block-type {
		font-weight: 600;
		text-transform: capitalize;
	}

	.block-id {
		font-family: var(--font-mono, monospace);
		font-size: var(--text-xs);
		color: var(--color-ink-65);
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-left: auto;
	}

	.tag {
		padding: 2px var(--space-3);
		font-size: 12px;
		font-weight: 600;
		border-radius: var(--radius-pill);
	}

	.tag.added {
		color: var(--color-green);
		background: var(--color-green-12);
	}

	.tag.removed {
		color: var(--color-danger);
		background: var(--color-danger-08);
	}

	.tag.moved,
	.tag.changed {
		color: var(--color-purple);
		background: var(--color-purple-08);
	}

	.tag.kept {
		color: var(--color-ink-65);
		background: var(--color-ink-12);
	}
</style>
