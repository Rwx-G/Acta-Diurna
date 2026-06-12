<script lang="ts">
	import type { Scale, Scales, TableBlock, TableCell } from '$lib/schema';
	import { resolveScaleRef } from '$lib/schema';
	import Badge from './Badge.svelte';
	import BlockPlaceholder from './BlockPlaceholder.svelte';

	// `scales`/`theme` are threaded for conditional column formatting (Epic 7,
	// Story 7.5): a column declaring a `scaleRef` renders its cells as scale-driven
	// badges (colour + label from the referenced scale, computed at render). A
	// column with no `scaleRef` renders plain escaped text exactly as before, so an
	// existing table is byte-identical. `scales` is undefined for documents that
	// declare no scales, in which case every column is plain text.
	let {
		block,
		scales,
		theme = 'default'
	}: { block: TableBlock; scales?: Scales; theme?: string } = $props();

	const rows = $derived(block.rows ?? []);
	const stickyHeader = $derived(block.options?.stickyHeader ?? true);

	function display(cell: TableCell | undefined): string {
		if (cell === undefined || cell === null) return '';
		if (typeof cell === 'boolean') return cell ? 'Yes' : 'No';
		return String(cell);
	}

	function isNumeric(cell: TableCell | undefined): boolean {
		return typeof cell === 'number';
	}

	// A column renders as badges only when it declares a `scaleRef` AND that scale
	// resolves. A dangling `scaleRef` is a validation error on the reader path; in
	// the workspace preview it falls back to plain text rather than blanking.
	function columnScale(scaleRef: string | undefined): Scale | undefined {
		return scaleRef ? resolveScaleRef(scales, scaleRef) : undefined;
	}

	// A cell renders a badge only when its column is scale-formatted and the cell
	// carries a non-empty value (an empty cell renders blank, not a badge).
	function badgeKey(cell: TableCell | undefined): string | undefined {
		if (cell === undefined || cell === null || cell === '') return undefined;
		return String(cell);
	}
</script>

{#if rows.length === 0}
	<BlockPlaceholder />
{:else}
	<div class="table-scroll">
		<table class:sticky={stickyHeader}>
			<thead>
				<tr>
					{#each block.columns as column (column.key)}
						<th scope="col">{column.label}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each rows as row, rowIndex (rowIndex)}
					<tr>
						{#each block.columns as column (column.key)}
							{@const scale = columnScale(column.scaleRef)}
							{#if scale}
								{@const key = badgeKey(row[column.key])}
								<td class="badge-cell">
									{#if key !== undefined}
										<Badge {scale} entryKey={key} {theme} />
									{/if}
								</td>
							{:else}
								<td class:numeric={isNumeric(row[column.key])}>{display(row[column.key])}</td>
							{/if}
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	.table-scroll {
		overflow-x: auto;
		border: 1px solid var(--report-rule);
		border-radius: var(--radius-md);
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
	}

	th {
		padding: var(--space-3) var(--space-4);
		text-align: left;
		font-weight: 600;
		color: var(--report-heading);
		background: var(--report-surface);
		border-bottom: 2px solid var(--report-rule-strong);
		white-space: nowrap;
	}

	table.sticky thead th {
		position: sticky;
		top: 0;
		z-index: 1;
	}

	td {
		padding: var(--space-3) var(--space-4);
		color: var(--report-text);
		border-bottom: 1px solid var(--report-rule);
	}

	td.numeric {
		text-align: right;
	}

	tbody tr:last-child td {
		border-bottom: none;
	}

	tbody tr:nth-child(even) td {
		background: color-mix(in srgb, var(--report-text) 3%, transparent);
	}
</style>
