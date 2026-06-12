<script lang="ts">
	import type { CodeBlock } from '$lib/schema';

	// SSR-only, zero hydration (the renderer-purity boundary): a static, selectable
	// <pre><code> monospace block. The code is Svelte text interpolation (no
	// {@html}), so a snippet reading "<script>" renders as inert visible text - the
	// content is never parsed as markup nor executed. `white-space: pre` preserves
	// every space and newline verbatim. The optional `language` is shown as a small
	// CAPTION only, never used to highlight (no highlighter library, no client JS).
	// Annotations render as adjacent escaped text. There is deliberately NO
	// copy-to-clipboard button: that needs hydration and would move the reader JS
	// budget (NFR3, Phase B foundational design); a copy affordance is out of scope.
	let { block }: { block: CodeBlock } = $props();
</script>

<figure class="code-block">
	{#if block.language}
		<figcaption class="code-language">{block.language}</figcaption>
	{/if}
	<pre class="code-pre"><code>{block.code}</code></pre>
	{#if block.annotations && block.annotations.length > 0}
		<ul class="code-annotations">
			{#each block.annotations as annotation, annotationIndex (annotationIndex)}
				<li>
					{#if annotation.line !== undefined}<span class="annotation-line"
							>Line {annotation.line}</span
						>{/if}<span class="annotation-text">{annotation.text}</span>
				</li>
			{/each}
		</ul>
	{/if}
</figure>

<style>
	.code-block {
		margin: 0;
	}

	.code-language {
		display: inline-block;
		margin-bottom: var(--space-1);
		padding: 0 var(--space-2);
		font-family: var(--font-sans);
		font-size: var(--text-xs);
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--report-text-muted);
	}

	.code-pre {
		margin: 0;
		padding: var(--space-4) var(--space-5);
		overflow-x: auto;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		line-height: var(--leading-relaxed);
		color: var(--report-text);
		background: var(--report-surface);
		border: 1px solid var(--report-rule-strong);
		border-radius: var(--radius-sm);
		/* Preserve every space and newline of the literal source verbatim. */
		white-space: pre;
		tab-size: 2;
	}

	.code-pre code {
		font: inherit;
	}

	.code-annotations {
		margin: var(--space-2) 0 0;
		padding: 0;
		list-style: none;
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		color: var(--report-text-muted);
	}

	.code-annotations li {
		margin-bottom: var(--space-1);
	}

	.annotation-line {
		margin-right: var(--space-2);
		font-family: var(--font-mono);
		font-weight: 600;
		color: var(--report-text);
	}
</style>
