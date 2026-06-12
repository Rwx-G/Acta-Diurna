<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Scales } from '$lib/schema';
	import type { SectionView } from './document-view.ts';
	import BlockRenderer from './blocks/BlockRenderer.svelte';

	// A section is a viewport-filling card in slide mode (overflow scrolls within
	// the card, never paging the section away mid-read) and a normal flow block
	// in scroll mode. The annex variant carries a quiet "Annex" eyebrow. The
	// section heading is the document's h2 under the report h1 (semantic
	// hierarchy, AAA).
	interface Props {
		section: SectionView;
		index: number;
		total: number;
		mode: 'slide' | 'scroll';
		/** Document scales, threaded to the block renderer (Epic 7). */
		scales?: Scales;
		/** Resolved theme name, for scale colour resolution at render. */
		theme?: string;
		/** Optional cover snippet rendered above the first section's content. */
		cover?: Snippet;
	}

	let { section, index, total, mode, scales, theme, cover }: Props = $props();
</script>

<!-- In slide mode the section is its own scroll container (content taller than
     the viewport scrolls within the card). A scrollable region must be
     keyboard-reachable so a keyboard user can scroll it, hence tabindex="0"
     (axe scrollable-region-focusable). In scroll mode the page scrolls, so no
     tabindex is needed. The section is a scroll container, a recognized
     exception to the non-interactive-tabindex rule. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<section
	id={section.id}
	class="section {mode}"
	class:annex={section.annex}
	aria-labelledby="{section.id}-heading"
	aria-roledescription={mode === 'slide' ? 'slide' : undefined}
	tabindex={mode === 'slide' ? 0 : undefined}
>
	<div class="section-inner">
		{#if cover}
			{@render cover()}
		{/if}

		<header class="section-header">
			{#if section.annex}
				<p class="eyebrow">Annex</p>
			{/if}
			<h2 id="{section.id}-heading">{section.title}</h2>
			<p class="section-index" aria-hidden="true">{index + 1} / {total}</p>
		</header>

		{#if section.invalidNotice}
			<p class="section-invalid" role="status">{section.invalidNotice}</p>
		{/if}

		<div class="section-body">
			{#each section.blocks as blockView (blockView.anchorId)}
				<BlockRenderer view={blockView} {scales} {theme} />
			{/each}
		</div>
	</div>
</section>

<style>
	.section {
		box-sizing: border-box;
		background: var(--report-bg);
		color: var(--report-text);
	}

	/* Slide mode: each section fills the viewport; content scrolls inside. */
	.section.slide {
		height: 100dvh;
		overflow-y: auto;
		scroll-snap-align: start;
		display: flex;
		flex-direction: column;
	}

	/* Scroll mode: sections flow one after another. */
	.section.scroll {
		min-height: 60vh;
		border-bottom: 1px solid var(--report-rule);
	}

	.section-inner {
		width: 100%;
		max-width: 880px;
		margin: 0 auto;
		padding: var(--space-8) var(--space-5) var(--space-7);
		flex: 1 0 auto;
	}

	.section.annex {
		background: color-mix(in srgb, var(--report-text) 2%, var(--report-bg));
	}

	.section-header {
		margin-bottom: var(--space-6);
		padding-bottom: var(--space-3);
		border-bottom: 2px solid var(--report-rule-strong);
	}

	.eyebrow {
		margin: 0 0 var(--space-1);
		font-family: var(--font-sans);
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--report-accent);
	}

	h2 {
		margin: 0;
		font-family: var(--font-sans);
		font-size: var(--text-xl);
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--report-heading);
	}

	.section-index {
		margin: var(--space-2) 0 0;
		font-family: var(--font-sans);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		color: var(--report-text-muted);
	}

	.section-invalid {
		margin: 0 0 var(--space-5);
		padding: var(--space-3) var(--space-4);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		color: var(--color-amber);
		background: var(--color-amber-12);
		border-radius: var(--radius-sm);
	}

	@media (max-width: 768px) {
		.section-inner {
			padding: var(--space-6) var(--space-4) var(--space-6);
		}
	}
</style>
