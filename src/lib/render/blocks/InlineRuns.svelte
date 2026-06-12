<script lang="ts">
	import type { Paragraph } from '$lib/schema';

	// The shared inline-run renderer (Story 7.8 vocabulary), the single source the
	// text / callout / list / timeline blocks delegate to. Narrative content is
	// data, never HTML (XSS rule, no exception): each run renders through Svelte
	// text interpolation - which escapes - so a run reading "<script>" is shown
	// literally. The only markup is the bold/italic/code/link marks the schema
	// permits; link hrefs are http(s)-restricted by the schema and carry
	// rel="external noopener noreferrer" + target="_blank" (the `external` token
	// also tells the SvelteKit lint rule this is not a route). The owning block
	// keeps its own <p> wrapper so its paragraph styling stays scoped to it; this
	// component owns only the inline marks and their styles.
	let { paragraph }: { paragraph: Paragraph } = $props();
</script>

<!-- One marked run: the text (always escaped interpolation) wrapped in the
	bold/italic/code marks the schema permits. A code run is a monospace <code>
	chip; the marks nest, so a bold inline-code run is <strong><code>. -->
{#snippet markedRun(run: Paragraph[number])}{#if run.code}<code class="run-code"
			>{#if run.bold && run.italic}<strong><em>{run.text}</em></strong>{:else if run.bold}<strong
					>{run.text}</strong
				>{:else if run.italic}<em>{run.text}</em>{:else}{run.text}{/if}</code
		>{:else if run.bold && run.italic}<strong><em>{run.text}</em></strong>{:else if run.bold}<strong
			>{run.text}</strong
		>{:else if run.italic}<em>{run.text}</em>{:else}{run.text}{/if}{/snippet}

{#each paragraph as run, runIndex (runIndex)}
	{#if run.link}
		<a href={run.link.href} target="_blank" rel="external noopener noreferrer" class="run-link">
			{@render markedRun(run)}
		</a>
	{:else}{@render markedRun(run)}{/if}
{/each}

<style>
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
