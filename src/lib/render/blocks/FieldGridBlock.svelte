<script lang="ts">
	import type { FieldGridBlock } from '$lib/schema';

	// SSR-only, zero hydration (the renderer-purity boundary): a compact metadata
	// grid as a description list (<dl>/<dt>/<dd>, the semantic metadata element).
	// Every value is Svelte text interpolation (no {@html}), so a value of
	// "<script>" renders as inert text. This component ships no client JS, so the
	// reader budget (NFR3) is unaffected. The grid auto-fits two columns on
	// desktop and collapses to a single stacked column at the reader mobile
	// breakpoint (768px) via CSS only, no JS.
	let { block }: { block: FieldGridBlock } = $props();
</script>

<dl class="field-grid">
	{#each block.items as item, index (index)}
		<div class="field">
			<dt>{item.label}</dt>
			<dd>{item.value}</dd>
		</div>
	{/each}
</dl>

<style>
	.field-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-3) var(--space-5);
		margin: 0;
	}

	@media (max-width: 768px) {
		.field-grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3) 0;
		border-bottom: 1px solid var(--report-rule);
	}

	dt {
		font-family: var(--font-sans);
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--report-text-muted);
	}

	dd {
		margin: 0;
		font-family: var(--font-sans);
		font-size: var(--text-md);
		color: var(--report-text);
	}
</style>
