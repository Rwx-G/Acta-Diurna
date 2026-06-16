<script lang="ts">
	import type { TextBlock } from '$lib/schema';
	import InlineRuns from './InlineRuns.svelte';

	// Narrative content is data, never HTML (XSS rule, no exception): the body
	// renders through the shared InlineRuns component, which escapes every run and
	// owns the bold/italic/code/link marks. This component keeps the prose <p>
	// styling scoped to the text block.
	let { block }: { block: TextBlock } = $props();
</script>

<div class="text-block">
	{#each block.paragraphs as paragraph, paragraphIndex (paragraphIndex)}
		<p><InlineRuns {paragraph} /></p>
	{/each}
</div>

<style>
	/* Prose caps at the readable measure and CENTRES within the content column, so a
	   wide (or full-bleed) report frames the text with balanced margins instead of a
	   short line hugging the left with a large empty gutter on the right. Wide blocks
	   (tables, charts) still fill the column; the centred prose is the editorial pairing. */
	.text-block {
		max-width: var(--measure-prose);
		margin-inline: auto;
	}

	p {
		margin: 0 0 var(--space-4);
		font-family: var(--font-serif);
		font-size: var(--text-md);
		line-height: var(--leading-relaxed);
		color: var(--report-text);
	}

	p:last-child {
		margin-bottom: 0;
	}
</style>
