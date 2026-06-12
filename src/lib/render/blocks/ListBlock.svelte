<script lang="ts">
	import type { ListBlock } from '$lib/schema';
	import InlineRuns from './InlineRuns.svelte';

	// SSR-only, zero hydration (the renderer-purity boundary): a structured list.
	// The `ordered` flag picks a real <ol> (a numbered procedure / steps list) or a
	// real <ul> (an unordered checklist), so the markup is semantically correct for
	// screen readers. The step numbering is the NATIVE list ordinal: the schema
	// carries no per-item number, the <ol> numbers its <li> children, so reordering
	// items renumbers automatically and a hand-authored number can never drift.
	//
	// Each item is a bold lead `term` and an optional rich-text `description` that
	// reuses the text block's inline-run vocabulary (the same marked-run snippet the
	// callout block uses), so bold/italic, the 7.8 inline-code chip, and http(s)
	// links all work. Every value is Svelte text interpolation (no {@html}), so a
	// term or run reading "<script>" renders as inert text; link hrefs are
	// http(s)-restricted by the schema. This component ships no client JS, so the
	// reader budget (NFR3) is unaffected.
	let { block }: { block: ListBlock } = $props();
</script>

{#snippet items()}
	{#each block.items as item, index (index)}
		<li class="list-item">
			{#if item.term}<span class="list-term">{item.term}</span>{/if}
			{#if item.description}
				<div class="list-description">
					{#each item.description as paragraph, paragraphIndex (paragraphIndex)}
						<p><InlineRuns {paragraph} /></p>
					{/each}
				</div>
			{/if}
		</li>
	{/each}
{/snippet}

{#if block.ordered}
	<ol class="list ordered">{@render items()}</ol>
{:else}
	<ul class="list unordered">{@render items()}</ul>
{/if}

<style>
	.list {
		margin: 0;
		padding-left: var(--space-6);
		font-family: var(--font-sans);
		color: var(--report-text);
	}

	.list-item {
		margin: 0 0 var(--space-3);
		font-size: var(--text-md);
		line-height: var(--leading-relaxed);
	}

	.list-item:last-child {
		margin-bottom: 0;
	}

	.list-term {
		font-weight: 600;
	}

	.list-description {
		margin-top: var(--space-1);
	}

	.list-description p {
		margin: 0 0 var(--space-2);
	}

	.list-description p:last-child {
		margin-bottom: 0;
	}
</style>
