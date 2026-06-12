<script lang="ts">
	import type { CardGridBlock } from '$lib/schema';
	import Icon from './Icon.svelte';

	// SSR-only, zero hydration (the renderer-purity boundary): a responsive N-up
	// grid of icon + title + description cards. The desktop column count comes from
	// `block.columns` (1..4, schema-capped), threaded through a `--card-columns`
	// custom property so the grid template is data-driven without inline style
	// arithmetic; at the reader mobile breakpoint (768px) the grid collapses to a
	// single stacked column via CSS only, no JS.
	//
	// The icon is DECORATIVE (aria-hidden, from 7.6): the title and description
	// carry the meaning, so the icon is never the sole signal (NFR14). A card with
	// no icon renders title + description only. Every value is Svelte text
	// interpolation (no {@html}), so a title or description reading "<script>"
	// renders as inert text. This component ships no client JS, so the reader
	// budget (NFR3) is unaffected.
	let { block }: { block: CardGridBlock } = $props();
</script>

<ul class="card-grid" style="--card-columns: {block.columns}">
	{#each block.items as item, index (index)}
		<li class="card">
			{#if item.icon}<span class="card-icon"><Icon name={item.icon} /></span>{/if}
			<p class="card-title">{item.title}</p>
			<p class="card-description">{item.description}</p>
		</li>
	{/each}
</ul>

<style>
	.card-grid {
		display: grid;
		grid-template-columns: repeat(var(--card-columns), minmax(0, 1fr));
		gap: var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	@media (max-width: 768px) {
		.card-grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-4) var(--space-5);
		background: var(--report-surface);
		border: 1px solid var(--report-rule);
		border-radius: var(--radius-sm);
	}

	.card-icon {
		display: inline-flex;
		font-size: var(--text-xl);
		color: var(--report-accent);
	}

	.card-title {
		margin: 0;
		font-family: var(--font-sans);
		font-size: var(--text-md);
		font-weight: 600;
		color: var(--report-text);
	}

	.card-description {
		margin: 0;
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		line-height: var(--leading-relaxed);
		color: var(--report-text-muted);
	}
</style>
