<script lang="ts">
	import { formatUtcDateTime } from '$lib/format';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import PageHeader from '$lib/ui/PageHeader.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// The reader filter is an opaque id carried in the URL; surface the email of
	// the matching row so the active filter reads as a person, not a uuid. When
	// the filter matches no row (id typed by hand, or the reader's accesses fell
	// out of retention) fall back to the id itself.
	let activeReaderEmail = $derived(
		data.filter.readerId
			? (data.accesses.find((entry) => entry.readerIdentityId === data.filter.readerId)
					?.readerEmail ?? data.filter.readerId)
			: null
	);

	let hasFilter = $derived(data.filter.reportId !== '' || data.filter.readerId !== '');
</script>

<svelte:head>
	<title>Access audit - Acta Diurna</title>
</svelte:head>

<PageHeader
	title="Access audit"
	lede="Who opened which of your reports, and when. Filter by report or by reader. How long this history is kept is set by your operator (ACCESS_RECORD_RETENTION_DAYS)."
/>

<!-- All filtering is plain GET form submission (no-JS friendly, and it keeps the
     filter state in the URL): the report dropdown plus an optional carried-over
     reader id submit together; the per-row reader links and the clear/reset
     controls are their own tiny GET forms, so no manual query-string building. -->
<div class="filters">
	<form class="filter-form" method="GET">
		<label class="field">
			<span class="field-label">Report</span>
			<select name="report">
				<option value="">All reports</option>
				{#each data.reportOptions as report (report.id)}
					<option value={report.id} selected={report.id === data.filter.reportId}>
						{report.title}
					</option>
				{/each}
			</select>
		</label>

		<!-- Carry the active reader across a report-filter change so the two compose. -->
		{#if data.filter.readerId}
			<input type="hidden" name="reader" value={data.filter.readerId} />
		{/if}

		<button type="submit">Apply</button>
	</form>

	{#if data.filter.readerId}
		<span class="chip">
			Reader: {activeReaderEmail}
			<!-- Clearing the reader keeps the report filter, drops only the reader. -->
			<form method="GET" class="inline-form">
				{#if data.filter.reportId}
					<input type="hidden" name="report" value={data.filter.reportId} />
				{/if}
				<button type="submit" class="link-button">clear</button>
			</form>
		</span>
	{/if}

	{#if hasFilter}
		<form method="GET" class="inline-form">
			<button type="submit" class="reset">Reset</button>
		</form>
	{/if}
</div>

{#if data.accesses.length === 0}
	<EmptyState
		title={hasFilter ? 'No accesses match these filters' : 'No accesses recorded yet'}
		description={hasFilter
			? 'No reader opened a report matching the current filters.'
			: 'When a reader opens one of your shared reports, the access is recorded here.'}
	/>
{:else}
	<table class="log">
		<thead>
			<tr>
				<th>Report</th>
				<th>Reader</th>
				<th>Opened</th>
			</tr>
		</thead>
		<tbody>
			{#each data.accesses as entry (entry.id)}
				<tr>
					<td>{entry.reportTitle}</td>
					<td>
						<!-- Filter by this reader (keeping any active report filter) via a GET
						     form submission rather than a hand-built query-string link. -->
						<form method="GET" class="inline-form">
							<input type="hidden" name="reader" value={entry.readerIdentityId} />
							{#if data.filter.reportId}
								<input type="hidden" name="report" value={data.filter.reportId} />
							{/if}
							<button type="submit" class="reader-link" title="Filter by this reader"
								>{entry.readerEmail}</button
							>
						</form>
					</td>
					<td class="when">{formatUtcDateTime(entry.accessedAt)}</td>
				</tr>
			{/each}
		</tbody>
	</table>

	<!-- A non-null nextCursor means older accesses remain past this page: surface a
	     "Load older" control so the trail is never silently cut off. It carries the
	     active report/reader filters so paging composes with filtering. -->
	{#if data.nextCursor}
		<form method="GET" class="load-older">
			{#if data.filter.reportId}
				<input type="hidden" name="report" value={data.filter.reportId} />
			{/if}
			{#if data.filter.readerId}
				<input type="hidden" name="reader" value={data.filter.readerId} />
			{/if}
			<input type="hidden" name="cursor" value={data.nextCursor} />
			<button type="submit">Load older</button>
		</form>
	{/if}
{/if}

<style>
	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--space-3);
		max-width: var(--content-width);
		margin: 0 auto var(--space-5);
	}

	.filter-form {
		display: flex;
		align-items: flex-end;
		gap: var(--space-3);
	}

	.inline-form {
		display: inline;
		margin: 0;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.field-label {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-ink-50);
	}

	select {
		padding: var(--space-2) var(--space-3);
		font: inherit;
		color: var(--color-ink);
		background: var(--color-surface);
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-3);
		font-size: var(--text-sm);
		background: var(--color-purple-08);
		color: var(--color-purple);
		border-radius: var(--radius-sm);
	}

	/* The boxy control is the Apply button only; clear/reset/reader are text. */
	.filter-form button[type='submit'] {
		padding: var(--space-2) var(--space-4);
		font: inherit;
		color: var(--color-ink);
		background: var(--color-surface);
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.filter-form button[type='submit']:hover {
		border-color: var(--color-purple);
		color: var(--color-purple);
	}

	.link-button,
	.reset {
		padding: 0;
		font: inherit;
		background: none;
		border: none;
		cursor: pointer;
		color: var(--color-ink-65);
		text-decoration: underline;
	}

	.link-button:hover,
	.reset:hover {
		color: var(--color-purple);
	}

	.log {
		width: 100%;
		max-width: var(--content-width);
		margin: 0 auto;
		border-collapse: collapse;
	}

	.log th,
	.log td {
		padding: var(--space-2) var(--space-3);
		text-align: left;
		border-bottom: 1px solid var(--color-ink-12);
	}

	.log th {
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-ink-65);
	}

	.reader-link {
		padding: 0;
		font: inherit;
		background: none;
		border: none;
		cursor: pointer;
		color: var(--color-purple);
		text-decoration: none;
	}

	.reader-link:hover {
		text-decoration: underline;
	}

	.when {
		font-size: var(--text-sm);
		color: var(--color-ink-65);
		white-space: nowrap;
	}

	.load-older {
		display: flex;
		justify-content: center;
		max-width: var(--content-width);
		margin: var(--space-4) auto 0;
	}

	.load-older button {
		padding: var(--space-2) var(--space-4);
		font: inherit;
		color: var(--color-ink);
		background: var(--color-surface);
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.load-older button:hover {
		border-color: var(--color-purple);
		color: var(--color-purple);
	}
</style>
