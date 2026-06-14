<script lang="ts">
	import type { Scale, Scales, TableBlock, TableCell } from '$lib/schema';
	import { resolveScaleRef } from '$lib/schema';
	import Badge from './Badge.svelte';
	import BlockPlaceholder from './BlockPlaceholder.svelte';
	import DataAsOf from './DataAsOf.svelte';

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

	// Per-row internal link (Epic 11, Story 11.2): `block.rowLinks[i]` is the
	// optional `linkTo` (a validated section id, never a URL) for row `i`. The
	// drill-down anchor renders in the row's first cell as `#<section-id>`, escaped
	// by Svelte attribute interpolation - no scriptable URL can enter. A row with no
	// link (absent slot, or `null`) renders byte-identically to before. The
	// reveal/back/focus navigation lands in Story 11.3.
	function rowLink(rowIndex: number): string | undefined {
		const linkTo = block.rowLinks?.[rowIndex];
		return typeof linkTo === 'string' ? linkTo : undefined;
	}

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
	<div class="data-block">
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
						{@const link = rowLink(rowIndex)}
						<tr>
							{#each block.columns as column, columnIndex (column.key)}
								{@const scale = columnScale(column.scaleRef)}
								{#if scale}
									{@const key = badgeKey(row[column.key])}
									<td class="badge-cell">
										{#if key !== undefined}
											<Badge {scale} entryKey={key} {theme} />
										{/if}
									</td>
								{:else if link && columnIndex === 0}
									<td class:numeric={isNumeric(row[column.key])}>
										<a href={`#${link}`} class="row-link" data-internal-link={link}
											>{display(row[column.key])}</a
										>
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
		<DataAsOf dataAsOf={block.binding?.dataAsOf} />
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

	.row-link {
		color: var(--report-accent);
		text-decoration: underline;
		text-underline-offset: 0.15em;
		text-decoration-thickness: 0.06em;
	}

	.row-link:hover {
		text-decoration-thickness: 0.12em;
	}

	tbody tr:last-child td {
		border-bottom: none;
	}

	tbody tr:nth-child(even) td {
		background: color-mix(in srgb, var(--report-text) 3%, transparent);
	}
</style>
