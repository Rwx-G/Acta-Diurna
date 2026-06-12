<script lang="ts">
	import type { CalloutBlock } from '$lib/schema';
	import Icon from './Icon.svelte';

	// SSR-only, zero hydration (the renderer-purity boundary): a tinted,
	// left-accent-bordered box. The accent colour is resolved from the tone via a
	// theme-owned semantic token (--report-tone-<tone> in app.css), NEVER raw hex
	// in this component, so a new theme re-skins every callout with no code change
	// (the FR39 token stance). The tone is a closed enum, so the tone class maps to
	// exactly one token; the `--tone-color` custom property is the single seam.
	//
	// Tone is conveyed by MORE than colour (NFR14): the uppercase kicker label
	// and/or the icon carry the meaning, so the callout survives without colour.
	// The body uses --report-text (AAA on the default theme); the tint is a low
	// wash of the tone over the surface, decorative (not contrast-gated against the
	// body text). Every body value is Svelte text interpolation (no {@html}), so a
	// run reading "<script>" renders as inert text, exactly as the text block does;
	// link hrefs are http(s)-restricted by the schema. This component ships no
	// client JS, so the reader budget (NFR3) is unaffected.
	let { block }: { block: CalloutBlock } = $props();
</script>

<aside class="callout tone-{block.tone}">
	{#if block.icon || block.kicker}
		<div class="callout-header">
			{#if block.icon}<span class="callout-icon"><Icon name={block.icon} /></span>{/if}
			{#if block.kicker}<span class="callout-kicker">{block.kicker}</span>{/if}
		</div>
	{/if}
	<div class="callout-body">
		{#each block.body as paragraph, paragraphIndex (paragraphIndex)}
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
</aside>

<style>
	.callout {
		padding: var(--space-4) var(--space-5);
		border-left: 4px solid var(--tone-color);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--tone-color) 8%, var(--report-surface));
		font-family: var(--font-sans);
	}

	/* The tone class is the single seam from the closed enum to the theme token.
	   No raw hex here: each tone names its --report-tone-<tone> custom property. */
	.tone-info {
		--tone-color: var(--report-tone-info);
	}

	.tone-success {
		--tone-color: var(--report-tone-success);
	}

	.tone-warning {
		--tone-color: var(--report-tone-warning);
	}

	.tone-danger {
		--tone-color: var(--report-tone-danger);
	}

	.tone-neutral {
		--tone-color: var(--report-tone-neutral);
	}

	.callout-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
		color: var(--tone-color);
	}

	.callout-icon {
		display: inline-flex;
		font-size: var(--text-lg);
	}

	.callout-kicker {
		font-size: var(--text-xs);
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.callout-body p {
		margin: 0 0 var(--space-3);
		font-size: var(--text-md);
		line-height: var(--leading-relaxed);
		color: var(--report-text);
	}

	.callout-body p:last-child {
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
