<script lang="ts" module>
	import { audiencesAttr, type ChangeSummaryEntry } from '$lib/schema';

	import { DIRECTION_GLYPH, DIRECTION_WORD } from './blocks/direction.ts';
	import { formatDelta } from './blocks/KpiDelta.svelte';

	const VERDICT_LABEL = { added: 'Added', removed: 'Removed', updated: 'Updated' } as const;
</script>

<script lang="ts">
	// The Story 9.5 reader-facing "changes since the previous issue" panel. OPT-IN and
	// OFF by default: it renders only when the published, opted-in issue baked non-empty
	// entries (sections added/removed/updated since the predecessor, plus headline KPI
	// movements). The entries are computed SERVER-SIDE at publish (the `binding.delta`
	// precedent) and read straight off the validated document here - this component does
	// NO computation, never touches `$lib/server`, and never sees prior-issue raw data:
	// only the leak-safe facts (section ids/titles, the change verdict, the section's own
	// audience tags, and the already-baked deltas) reach it.
	//
	// SSR and escaped: every value is rendered as escaped text (Svelte's default), never
	// `{@html}`, so a section title or label is text, not markup. The panel needs no JS
	// to render (it is part of the SSR document), so it adds nothing to the reader budget.
	//
	// Audience-aware (AC2): each entry carries its SECTION's audience tags on
	// `data-audiences`, so the SAME reader CSS that hides a section at the reader's level
	// hides the summary line for it - the summary never references a section the reader's
	// level conceals. An untagged section's entry carries no `data-audiences` and shows at
	// every level, exactly like the section itself.
	//
	// A KPI block can carry its OWN audience tags, narrower than its section's: a movement
	// therefore carries the leak-safe intersection of the section's and the block's tags
	// (baked server-side) on its own `data-audiences`, so the SAME CSS hides the movement
	// line whenever EITHER the section or the block is hidden at the reader's level. A
	// `technical`-tagged KPI inside a section visible at `summary` thus never surfaces its
	// figure at `summary` - the summary line is hidden in lockstep with the block itself.
	let { entries }: { entries: ChangeSummaryEntry[] } = $props();
</script>

{#if entries.length > 0}
	<section class="change-summary" aria-labelledby="change-summary-heading">
		<!-- A labelled landmark, not a document heading: the panel leads the report (before
		     the cover h1 in DOM order), so a real <h2> here would break the h1-first heading
		     order (axe `heading-order`). The styled <p> names the region via aria-labelledby,
		     so assistive tech announces it without disturbing the heading outline. -->
		<p id="change-summary-heading" class="change-summary-heading">
			Changes since the previous issue
		</p>
		<ul class="change-summary-list">
			{#each entries as entry (entry.sectionId)}
				<li class="change-summary-entry" data-audiences={audiencesAttr(entry.audiences)}>
					<p class="entry-headline">
						<span class="verdict verdict-{entry.change}">{VERDICT_LABEL[entry.change]}</span>
						<span class="section-title">{entry.sectionTitle}</span>
					</p>
					{#if entry.movements && entry.movements.length > 0}
						<ul class="movement-list">
							{#each entry.movements as movement, index (index)}
								<li
									class="movement movement-{movement.delta.direction}"
									data-audiences={audiencesAttr(movement.audiences)}
								>
									<span class="movement-glyph" aria-hidden="true"
										>{DIRECTION_GLYPH[movement.delta.direction]}</span
									>
									<span class="movement-label">{movement.label}</span>
									<span class="sr-only">{DIRECTION_WORD[movement.delta.direction]}</span>
									<span class="movement-figure">{formatDelta(movement.delta)}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.change-summary {
		max-width: var(--reader-width, 1280px);
		margin: var(--space-6) auto 0;
		padding: var(--space-5);
		font-family: var(--font-sans);
		background: color-mix(in srgb, var(--report-surface) 92%, transparent);
		border: 1px solid var(--report-rule);
		border-radius: var(--radius-card, 12px);
	}

	.change-summary-heading {
		margin: 0 0 var(--space-4);
		font-size: var(--text-lg);
		font-weight: 700;
		color: var(--report-text);
	}

	.change-summary-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.entry-headline {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		margin: 0;
	}

	.verdict {
		font-size: var(--text-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--report-text-muted);
	}

	.section-title {
		font-size: var(--text-md, var(--text-sm));
		font-weight: 600;
		color: var(--report-text);
	}

	.movement-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin: var(--space-1) 0 0;
		padding: 0 0 0 var(--space-4);
		list-style: none;
	}

	.movement {
		display: flex;
		align-items: baseline;
		gap: var(--space-1);
		font-size: var(--text-sm);
		color: var(--report-text-muted);
	}

	.movement-glyph {
		font-size: var(--text-xs);
	}

	.movement-up .movement-glyph,
	.movement-up .movement-figure {
		color: var(--report-trend-up);
	}

	.movement-down .movement-glyph,
	.movement-down .movement-figure {
		color: var(--report-trend-down);
	}

	.movement-figure {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
