<script lang="ts">
	import type { TextBlock } from '$lib/schema';

	// Narrative content is data, never HTML (XSS rule, no exception). Inline runs
	// render through Svelte text interpolation - which escapes - so a run reading
	// "<script>" is shown literally. The only markup is the bold/italic/link
	// elements the schema permits; link hrefs are http(s)-restricted by the
	// schema and carry rel="external noopener noreferrer" + target="_blank" (the
	// `external` token also tells the SvelteKit lint rule this is not a route).
	let { block }: { block: TextBlock } = $props();
</script>

<div class="text-block">
	{#each block.paragraphs as paragraph, paragraphIndex (paragraphIndex)}
		<p>
			{#each paragraph as run, runIndex (runIndex)}
				{#if run.link}
					<a
						href={run.link.href}
						target="_blank"
						rel="external noopener noreferrer"
						class="run-link"
					>
						{#if run.bold && run.italic}<strong><em>{run.text}</em></strong>
						{:else if run.bold}<strong>{run.text}</strong>
						{:else if run.italic}<em>{run.text}</em>
						{:else}{run.text}{/if}
					</a>
				{:else if run.bold && run.italic}<strong><em>{run.text}</em></strong>
				{:else if run.bold}<strong>{run.text}</strong>
				{:else if run.italic}<em>{run.text}</em>
				{:else}{run.text}{/if}
			{/each}
		</p>
	{/each}
</div>

<style>
	.text-block {
		max-width: var(--measure-prose);
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
</style>
