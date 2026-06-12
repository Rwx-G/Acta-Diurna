<script lang="ts">
	import type { TableBlock, TableCell } from '$lib/schema';
	import BlockPlaceholder from './BlockPlaceholder.svelte';

	let { block }: { block: TableBlock } = $props();

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
							<td class:numeric={isNumeric(row[column.key])}>{display(row[column.key])}</td>
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
