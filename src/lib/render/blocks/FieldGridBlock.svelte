<script lang="ts">
	import type { FieldGridBlock } from '$lib/schema';

	// SSR-only, zero hydration (the renderer-purity boundary): a compact metadata
	// grid as a description list (<dl>/<dt>/<dd>, the semantic metadata element).
	// Every value is Svelte text interpolation (no {@html}), so a value of
	// "<script>" renders as inert text. This component ships no client JS, so the
	// reader budget (NFR3) is unaffected. The default `grid` layout auto-fits two
	// columns on desktop and collapses to a single stacked column at the reader
	// mobile breakpoint (768px) via CSS only, no JS. The optional `strip` layout
	// (Story 7.12) lays the same items out as a horizontal, centred row of
	// label-over-value cells separated by dividers (the correlation report's
	// meta-strip under the title), wrapping to a stacked column at the same
	// breakpoint via CSS only. The `strip` styling is additive: a block with no
	// `layout` (or `layout: 'grid'`) carries no extra class and renders exactly as
	// before.
	let { block }: { block: FieldGridBlock } = $props();
</script>

<dl class="field-grid" class:strip={block.layout === 'strip'}>
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

	/* Story 7.12 meta-strip variant: a horizontal, centred row of divided cells. */
	.field-grid.strip {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: stretch;
		gap: var(--space-3) var(--space-6);
	}

	.strip .field {
		align-items: center;
		text-align: center;
		border-bottom: none;
		position: relative;
	}

	.strip .field + .field::before {
		content: '';
		position: absolute;
		left: calc(var(--space-6) / -2);
		top: 50%;
		transform: translateY(-50%);
		width: 1px;
		height: 2em;
		background: var(--report-rule);
	}

	@media (max-width: 768px) {
		.field-grid.strip {
			flex-direction: column;
		}

		.strip .field + .field::before {
			content: none;
		}
	}
</style>
