<script lang="ts">
	import type { TableBlock } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';
	import BindingEditor from './BindingEditor.svelte';

	interface Props {
		block: TableBlock;
		onEdit: () => void;
	}

	let { block = $bindable(), onEdit }: Props = $props();

	function renameColumnKey(columnIndex: number, key: string): void {
		const oldKey = block.columns[columnIndex].key;
		if (key === oldKey) return;
		block.columns[columnIndex].key = key;
		// Static rows are keyed by column key: migrate values so a rename never
		// silently orphans a column of data.
		for (const row of block.rows ?? []) {
			if (oldKey in row) {
				row[key] = row[oldKey];
				delete row[oldKey];
			}
		}
	}

	function removeColumn(columnIndex: number): void {
		const key = block.columns[columnIndex].key;
		block.columns.splice(columnIndex, 1);
		for (const row of block.rows ?? []) {
			delete row[key];
		}
	}
</script>

<p class="field-label">Columns</p>
{#each block.columns as column, columnIndex (columnIndex)}
	<div class="field-row">
		<input
			value={column.key}
			placeholder="key"
			oninput={(event) => {
				renameColumnKey(columnIndex, event.currentTarget.value);
				onEdit();
			}}
			aria-label={`Column ${columnIndex + 1} key`}
		/>
		<input
			value={column.label}
			placeholder="Label"
			oninput={(event) => {
				column.label = event.currentTarget.value;
				onEdit();
			}}
			aria-label={`Column ${columnIndex + 1} label`}
		/>
		<Button
			variant="danger"
			onclick={() => {
				removeColumn(columnIndex);
				onEdit();
			}}
			disabled={block.columns.length === 1}
			aria-label={`Remove column ${columnIndex + 1}`}
		>
			Remove
		</Button>
	</div>
{/each}
<Button
	onclick={() => {
		block.columns.push({
			key: `column-${block.columns.length + 1}`,
			label: `Column ${block.columns.length + 1}`
		});
		onEdit();
	}}
>
	Add column
</Button>

<p class="field-label">Static rows</p>
{#each block.rows ?? [] as row, rowIndex (rowIndex)}
	<div class="field-row">
		{#each block.columns as column (column.key)}
			<input
				value={String(row[column.key] ?? '')}
				placeholder={column.label}
				oninput={(event) => {
					row[column.key] = event.currentTarget.value;
					onEdit();
				}}
				aria-label={`Row ${rowIndex + 1}, ${column.label}`}
			/>
		{/each}
		<Button
			variant="danger"
			onclick={() => {
				block.rows!.splice(rowIndex, 1);
				if (block.rows!.length === 0) delete block.rows;
				onEdit();
			}}
			aria-label={`Remove row ${rowIndex + 1}`}
		>
			Remove
		</Button>
	</div>
{/each}
<Button
	onclick={() => {
		const row = Object.fromEntries(block.columns.map((column) => [column.key, '']));
		(block.rows ??= []).push(row);
		onEdit();
	}}
>
	Add row
</Button>
<BindingEditor bind:binding={block.binding} {onEdit} />

<style>
	.field-label {
		display: block;
		margin: var(--space-3) 0 var(--space-1);
		font-size: 12px;
		font-weight: 600;
		color: var(--color-ink-65);
	}

	.field-row {
		display: flex;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}

	input {
		padding: var(--space-1) var(--space-2);
		font: inherit;
		color: inherit;
		background: var(--color-surface);
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
	}

	.field-row input {
		flex: 1;
		min-width: 0;
	}
</style>
