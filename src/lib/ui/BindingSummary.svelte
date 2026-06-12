<script lang="ts">
	import type { BindingSummary } from '$lib/server/ingestion';

	// Header aggregate (UX Flow B "the refill"): "N bindings - all green" when
	// every bound block resolved, otherwise the counts by state. A live region so
	// a refill announces the new standing state to assistive tech (NFR15). No
	// summary is shown when the report has no bound blocks.
	interface Props {
		summary: BindingSummary;
	}

	let { summary }: Props = $props();

	const noun = $derived(summary.total === 1 ? 'binding' : 'bindings');
</script>

{#if summary.total > 0}
	<p class="summary" role="status" aria-live="polite">
		{#if summary.allGreen}
			<span class="dot bound" aria-hidden="true"></span>
			<strong>{summary.total} {noun} - all green</strong>
		{:else}
			<strong>{summary.total} {noun}</strong>
			{#if summary.bound > 0}<span class="count bound">{summary.bound} bound</span>{/if}
			{#if summary.drifted > 0}<span class="count drifted">{summary.drifted} drifted</span>{/if}
			{#if summary.unresolved > 0}
				<span class="count unresolved">{summary.unresolved} unresolved</span>
			{/if}
		{/if}
	</p>
{/if}

<style>
	.summary {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-ink);
	}

	.dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: var(--radius-pill);
	}

	.count {
		padding: 1px var(--space-2);
		font-size: 12px;
		font-weight: 600;
		border-radius: var(--radius-pill);
	}

	.bound {
		color: var(--color-green);
		background: var(--color-green-12);
	}

	.drifted {
		color: var(--color-amber);
		background: var(--color-amber-12);
	}

	.unresolved {
		color: var(--color-danger);
		background: var(--color-danger-08);
	}
</style>
