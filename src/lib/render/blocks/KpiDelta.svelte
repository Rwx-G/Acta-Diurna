<script lang="ts" module>
	import type { BindingDelta } from '$lib/schema';

	const DIRECTION_GLYPH = { up: '▲', down: '▼', flat: '▬' } as const;
	const DIRECTION_LABEL = { up: 'up', down: 'down', flat: 'no change' } as const;

	// Fixed locale + sign so the figure is byte-identical on the server and any
	// client - a deterministic SSR string with no hydration mismatch and no
	// dependence on the reader's locale. `signDisplay: 'always'` writes the leading
	// + / - so the direction is in the figure too, never colour alone.
	const NUMBER_FORMATTER = new Intl.NumberFormat('en-GB', {
		signDisplay: 'always',
		maximumFractionDigits: 2
	});
	const PERCENT_FORMATTER = new Intl.NumberFormat('en-GB', {
		style: 'percent',
		signDisplay: 'always',
		maximumFractionDigits: 1
	});

	/**
	 * The visible figure for a delta: the signed absolute change, plus the signed
	 * percent in parentheses when a relative is present (it is null against a zero
	 * baseline, so the absolute stands alone there). Pure formatting, deterministic.
	 */
	export function formatDelta(delta: BindingDelta): string {
		const absolute = NUMBER_FORMATTER.format(delta.absolute);
		if (delta.relative === null) return absolute;
		return `${absolute} (${PERCENT_FORMATTER.format(delta.relative)})`;
	}
</script>

<script lang="ts">
	// The Story 9.4 numeric delta indicator: a small, unobtrusive up/down/flat arrow
	// plus the signed change a data-bound KPI renders, measuring this issue's value
	// against the same value in the previous issue. The delta is PRECOMPUTED onto the
	// binding server-side at publish time (the `data_as_of` precedent) and read
	// straight off the validated document here - this component does NO computation
	// and never sees the prior issue's data, only the baked delta.
	//
	// Accessible by more than colour (NFR14): an explicit direction glyph AND the
	// signed figure carry the movement, with a visually-hidden word ("up"/"down"/"no
	// change") for assistive tech. When the binding carries no `delta` (a first issue,
	// no comparable prior value, a non-numeric value) the indicator is OMITTED
	// entirely - never a placeholder or a misleading zero.
	let { delta, baselineLabel }: { delta?: BindingDelta; baselineLabel?: string } = $props();
</script>

{#if delta !== undefined}
	<p class="kpi-delta kpi-delta-{delta.direction}">
		<span class="glyph" aria-hidden="true">{DIRECTION_GLYPH[delta.direction]}</span>
		<span class="sr-only">{DIRECTION_LABEL[delta.direction]}</span>
		<span class="figure">{formatDelta(delta)}</span>
		<span class="baseline">{baselineLabel ?? 'vs previous issue'}</span>
	</p>
{/if}

<style>
	.kpi-delta {
		margin: var(--space-2) 0 0;
		display: flex;
		align-items: baseline;
		gap: var(--space-1);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		font-weight: 500;
		letter-spacing: 0.01em;
		color: var(--report-text-muted);
	}

	.glyph {
		font-size: var(--text-xs);
	}

	.kpi-delta-up .glyph,
	.kpi-delta-up .figure {
		color: var(--report-trend-up);
	}

	.kpi-delta-down .glyph,
	.kpi-delta-down .figure {
		color: var(--report-trend-down);
	}

	.figure {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}

	.baseline {
		color: var(--report-text-muted);
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
