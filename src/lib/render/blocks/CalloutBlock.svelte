<script lang="ts">
	import type { CalloutBlock } from '$lib/schema';
	import Icon from './Icon.svelte';
	import InlineRuns from './InlineRuns.svelte';

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
			<p><InlineRuns {paragraph} /></p>
		{/each}
	</div>
</aside>

<style>
	/* The box carries a FULL border, not just the left accent: the 8% tint alone could
	   land on the page background on some themes (e.g. the cool Aurora bg vs the info
	   blue), making the callout vanish. A 1px border in the tone softened over the
	   surface (50%) defines the box edge on every theme, the 4px left accent keeps the
	   tone emphasis, and a 12% tint reads the tone in the fill. The body text stays
	   --report-text (AAA); the border/tint are decorative (not contrast-gated). */
	.callout {
		padding: var(--space-4) var(--space-5);
		border: 1px solid color-mix(in srgb, var(--tone-color) 50%, var(--report-surface));
		border-left: 4px solid var(--tone-color);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--tone-color) 12%, var(--report-surface));
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
</style>
