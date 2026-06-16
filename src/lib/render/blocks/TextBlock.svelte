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
	/* Prose fills the content column, left-aligned, like every other block (callouts,
	   lists, tables): one consistent measure per report. The line length is governed by
	   the per-report reader-width control, not a hard-coded prose cap, so an author who
	   wants shorter lines sets a fixed reader width. */
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
