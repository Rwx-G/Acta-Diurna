<script lang="ts">
	import type { KpiBlock } from '$lib/schema';

	let { block }: { block: KpiBlock } = $props();

	const TREND_GLYPH = { up: '▲', down: '▼', flat: '▬' } as const;
	const TREND_LABEL = { up: 'trending up', down: 'trending down', flat: 'unchanged' } as const;

	// A binding-only KPI block (no static items, awaiting Epic 2 data) renders a
	// quiet placeholder rather than an empty strip.
	const items = $derived(block.items ?? []);
</script>

{#if items.length === 0}
	<div class="kpi-placeholder">Awaiting data binding.</div>
{:else}
	<dl class="kpi-row" style="--kpi-count: {Math.min(items.length, 4)}">
		{#each items as item, index (index)}
			<div class="kpi">
				<dt>{item.label}</dt>
				<dd>
					<span class="value">{item.value}</span>{#if item.unit}<span class="unit">{item.unit}</span
						>{/if}
					{#if item.trend}
						<span class="trend trend-{item.trend}">
							<span aria-hidden="true">{TREND_GLYPH[item.trend]}</span>
							<span class="sr-only">{TREND_LABEL[item.trend]}</span>
						</span>
					{/if}
				</dd>
			</div>
		{/each}
	</dl>
{/if}

<style>
	.kpi-row {
		display: grid;
		grid-template-columns: repeat(var(--kpi-count), minmax(0, 1fr));
		gap: var(--space-4);
		margin: 0;
	}

	@media (max-width: 768px) {
		.kpi-row {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	.kpi {
		padding: var(--space-4);
		background: var(--report-surface);
		border: 1px solid var(--report-rule);
		border-radius: var(--radius-md);
		border-top: 3px solid var(--report-accent-fill);
	}

	dt {
		margin: 0 0 var(--space-2);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		font-weight: 500;
		letter-spacing: 0.01em;
		color: var(--report-text-muted);
	}

	dd {
		margin: 0;
		display: flex;
		align-items: baseline;
		gap: var(--space-1);
	}

	.value {
		font-family: var(--font-sans);
		font-size: var(--text-2xl);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		line-height: 1;
		color: var(--report-heading);
	}

	.unit {
		font-family: var(--font-sans);
		font-size: var(--text-md);
		font-weight: 500;
		color: var(--report-text-muted);
	}

	.trend {
		margin-left: auto;
		font-size: var(--text-sm);
	}

	.trend-up {
		color: var(--color-green);
	}

	.trend-down {
		color: var(--color-danger);
	}

	.trend-flat {
		color: var(--report-text-muted);
	}

	.kpi-placeholder {
		padding: var(--space-4);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		color: var(--report-text-muted);
		background: var(--report-surface);
		border: 1px dashed var(--report-rule-strong);
		border-radius: var(--radius-md);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
