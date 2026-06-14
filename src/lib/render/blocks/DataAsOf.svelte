<script lang="ts" module>
	// Fixed locale + UTC so the formatted caption is byte-identical on the server
	// and any client - a deterministic SSR string with no hydration mismatch and no
	// dependence on the reader's locale or timezone. The instant is the binding's
	// `dataAsOf` (Story 6.4): the data set's explicit `data_as_of` else its
	// injection time, already resolved server-side and baked onto the document.
	const FORMATTER = new Intl.DateTimeFormat('en-GB', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC'
	});

	/** Formats a binding `dataAsOf` ISO string, or returns null when unusable. */
	export function formatDataAsOf(iso: string | undefined): string | null {
		if (iso === undefined) return null;
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return null;
		return FORMATTER.format(date);
	}
</script>

<script lang="ts">
	// The FR16 data-freshness caption (Story 6.4): a small, unobtrusive "Data as of
	// <date>" line a data-bound block (table/chart/kpi) renders BELOW its content so
	// a reader never mistakes stale numbers for fresh ones. Shared by the three
	// bindable blocks so the treatment cannot drift. When the binding carries no
	// usable timestamp the caption is OMITTED entirely - never a placeholder or a
	// misleading "unknown" date.
	let { dataAsOf }: { dataAsOf?: string } = $props();

	const formatted = $derived(formatDataAsOf(dataAsOf));
</script>

{#if formatted !== null}
	<p class="data-as-of">Data as of {formatted}</p>
{/if}

<style>
	.data-as-of {
		margin: var(--space-2) 0 0;
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		font-weight: 500;
		letter-spacing: 0.01em;
		color: var(--report-text-muted);
	}
</style>
