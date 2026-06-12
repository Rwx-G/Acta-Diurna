<script lang="ts">
	import type { InlineRun, Scales, TimelineBlock } from '$lib/schema';
	import { resolveScaleRef } from '$lib/schema';
	import Badge from './Badge.svelte';

	// SSR-only, zero hydration (the renderer-purity boundary): an ordered timeline.
	// A real <ol> carries one <li> node per milestone, so the sequence is
	// semantically correct for screen readers and the order is the native list
	// order (the schema carries no per-milestone number). The connector is a pure
	// CSS line down the node markers - no SVG, no client JS - so there is no
	// separate accessible alternative to maintain: the list IS the structure, the
	// connector is decorative.
	//
	// Each milestone resolves its own status scale from the document scales (a
	// per-milestone { scaleRef, entry } pair, so two milestones may carry statuses
	// from different scales) and renders the shared status Badge (7.5): colour +
	// label from the scale, the label text ALWAYS present so colour is never the
	// sole signal (NFR14). The detail reuses the text block's inline-run vocabulary
	// (the same marked-run snippet the callout and list blocks use), so bold/italic,
	// the 7.8 inline-code chip, and http(s) links all work, rendered escaped (Svelte
	// text interpolation, no {@html}). This component ships no client JS, so the
	// reader budget (NFR3) is unaffected.
	let {
		block,
		scales,
		theme = 'default'
	}: { block: TimelineBlock; scales?: Scales; theme?: string } = $props();
</script>

<!-- The detail reuses the text block's inline-run vocabulary, including the 7.8
	inline-code mark: a code run is a monospace <code> chip, and the marks nest. -->
{#snippet markedRun(run: InlineRun)}{#if run.code}<code class="run-code"
			>{#if run.bold && run.italic}<strong><em>{run.text}</em></strong>{:else if run.bold}<strong
					>{run.text}</strong
				>{:else if run.italic}<em>{run.text}</em>{:else}{run.text}{/if}</code
		>{:else if run.bold && run.italic}<strong><em>{run.text}</em></strong>{:else if run.bold}<strong
			>{run.text}</strong
		>{:else if run.italic}<em>{run.text}</em>{:else}{run.text}{/if}{/snippet}

<figure class="timeline-block">
	{#if block.title}<figcaption class="timeline-title">{block.title}</figcaption>{/if}
	<ol class="timeline">
		{#each block.milestones as milestone, index (index)}
			{@const scale = resolveScaleRef(scales, milestone.status.scaleRef)}
			<li class="milestone">
				<span class="node" aria-hidden="true"></span>
				<div class="milestone-content">
					<div class="milestone-head">
						<span class="milestone-label">{milestone.label}</span>
						{#if scale}
							<Badge {scale} entryKey={milestone.status.entry} {theme} />
						{/if}
					</div>
					{#if milestone.date}<span class="milestone-date">{milestone.date}</span>{/if}
					{#if milestone.detail}
						<div class="milestone-detail">
							{#each milestone.detail as paragraph, paragraphIndex (paragraphIndex)}
								<p>
									{#each paragraph as run, runIndex (runIndex)}
										{#if run.link}
											<a
												href={run.link.href}
												target="_blank"
												rel="external noopener noreferrer"
												class="run-link"
											>
												{@render markedRun(run)}
											</a>
										{:else}{@render markedRun(run)}{/if}
									{/each}
								</p>
							{/each}
						</div>
					{/if}
				</div>
			</li>
		{/each}
	</ol>
</figure>

<style>
	.timeline-block {
		margin: 0;
		font-family: var(--font-sans);
	}

	.timeline-title {
		margin: 0 0 var(--space-3);
		font-size: var(--text-sm);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--report-heading);
	}

	.timeline {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.milestone {
		position: relative;
		padding: 0 0 var(--space-5) var(--space-6);
	}

	.milestone:last-child {
		padding-bottom: 0;
	}

	/* The connector: a vertical line down the left gutter, drawn from each node to
	   the next. Decorative (the <ol> carries the real order); not on the last node. */
	.milestone::before {
		content: '';
		position: absolute;
		left: 5px;
		top: var(--space-2);
		bottom: 0;
		width: 2px;
		background: var(--report-rule);
	}

	.milestone:last-child::before {
		display: none;
	}

	.node {
		position: absolute;
		left: 0;
		top: var(--space-1);
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--report-accent);
		border: 2px solid var(--report-bg);
		box-shadow: 0 0 0 1px var(--report-rule);
	}

	.milestone-content {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.milestone-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.milestone-label {
		font-size: var(--text-md);
		font-weight: 600;
		color: var(--report-heading);
	}

	.milestone-date {
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--report-text-muted);
	}

	.milestone-detail {
		margin-top: var(--space-1);
		color: var(--report-text);
	}

	.milestone-detail p {
		margin: 0 0 var(--space-2);
		font-size: var(--text-md);
		line-height: var(--leading-relaxed);
	}

	.milestone-detail p:last-child {
		margin-bottom: 0;
	}

	.run-link {
		color: var(--report-accent);
		text-decoration: underline;
		text-underline-offset: 0.15em;
		text-decoration-thickness: 0.06em;
	}

	.run-link:hover {
		text-decoration-thickness: 0.12em;
	}

	strong {
		font-weight: 600;
	}

	.run-code {
		padding: 0.1em 0.35em;
		font-family: var(--font-mono);
		font-size: 0.9em;
		color: var(--report-text);
		background: color-mix(in srgb, var(--report-text) 8%, var(--report-surface));
		border-radius: var(--radius-sm);
	}
</style>
