<script lang="ts">
	import type { Scales, TableBlock } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';
	import BindingEditor from './BindingEditor.svelte';
	import { moveItem } from './editor-state';

	interface Props {
		block: TableBlock;
		/** Document scales, for the optional per-column conditional formatting (7.5). */
		scales?: Scales;
		onEdit: () => void;
	}

	let { block = $bindable(), scales, onEdit }: Props = $props();

	const scaleOptions = $derived(scales ?? []);

	// A live "duplicate key" hint per column index: the optimistic twin of the
	// schema's dup-key 422, so the author sees the collision before the round-trip
	// rather than discovering it as a save failure. Keyed by index because the key
	// itself is what collides.
	let duplicateKeyIndex = $state<number | null>(null);

	function renameColumnKey(columnIndex: number, key: string): void {
		const oldKey = block.columns[columnIndex].key;
		if (key === oldKey) {
			duplicateKeyIndex = null;
			return;
		}
		// Column keys index the row records, so renaming a column onto a key another
		// column already owns would overwrite that column's cells across every row -
		// silent data loss the schema's dup-key refine also rejects. Guard it: keep
		// the old key, surface the collision, and let the author choose another name.
		if (block.columns.some((column, index) => index !== columnIndex && column.key === key)) {
			duplicateKeyIndex = columnIndex;
			return;
		}
		duplicateKeyIndex = null;
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
<!-- Index-keyed `{#each}`: reorder is adjacent-swap-only (`moveItem` ±1), so the
     keyed list never reshuffles non-adjacent entries and the index stays a stable
     key. A non-swap mutation would need an item-stable key instead. -->
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
			aria-invalid={duplicateKeyIndex === columnIndex}
			aria-describedby={duplicateKeyIndex === columnIndex
				? `column-key-error-${block.id}`
				: undefined}
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
		<select
			value={column.scaleRef ?? ''}
			onchange={(event) => {
				const value = event.currentTarget.value;
				if (value === '') delete column.scaleRef;
				else column.scaleRef = value;
				onEdit();
			}}
			aria-label={`Column ${columnIndex + 1} scale`}
		>
			<option value="">Plain text</option>
			{#each scaleOptions as scale (scale.key)}
				<option value={scale.key}>{scale.label}</option>
			{/each}
		</select>
		<Button
			onclick={() => {
				moveItem(block.columns, columnIndex, -1);
				onEdit();
			}}
			disabled={columnIndex === 0}
		>
			<span class="sr-only">{`Move column ${columnIndex + 1} left`}</span>
			<span aria-hidden="true">Left</span>
		</Button>
		<Button
			onclick={() => {
				moveItem(block.columns, columnIndex, 1);
				onEdit();
			}}
			disabled={columnIndex === block.columns.length - 1}
		>
			<span class="sr-only">{`Move column ${columnIndex + 1} right`}</span>
			<span aria-hidden="true">Right</span>
		</Button>
		<Button
			variant="ghost"
			onclick={() => {
				removeColumn(columnIndex);
				onEdit();
			}}
			disabled={block.columns.length === 1}
		>
			<span class="sr-only">{`Remove column ${columnIndex + 1}`}</span>
			<span aria-hidden="true">Remove</span>
		</Button>
	</div>
{/each}
{#if duplicateKeyIndex !== null}
	<p id={`column-key-error-${block.id}`} class="field-error" role="alert">
		That column key is already in use. Column keys must be unique, so the rename was not applied.
		Choose a different key.
	</p>
{/if}
<Button
	onclick={() => {
		// A collision-free key: a counter like `column-${length + 1}` reuses a stale
		// key after a delete (delete column-2, "Add column" regenerates column-2), and
		// the duplicate would clobber the surviving column's row cells. A UUID slug is
		// unique by construction; the human-facing LABEL stays the friendly counter.
		block.columns.push({
			key: crypto.randomUUID(),
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
			onclick={() => {
				moveItem(block.rows!, rowIndex, -1);
				onEdit();
			}}
			disabled={rowIndex === 0}
		>
			<span class="sr-only">{`Move row ${rowIndex + 1} up`}</span>
			<span aria-hidden="true">Up</span>
		</Button>
		<Button
			onclick={() => {
				moveItem(block.rows!, rowIndex, 1);
				onEdit();
			}}
			disabled={rowIndex === (block.rows?.length ?? 0) - 1}
		>
			<span class="sr-only">{`Move row ${rowIndex + 1} down`}</span>
			<span aria-hidden="true">Down</span>
		</Button>
		<Button
			variant="ghost"
			onclick={() => {
				block.rows!.splice(rowIndex, 1);
				if (block.rows!.length === 0) delete block.rows;
				onEdit();
			}}
		>
			<span class="sr-only">{`Remove row ${rowIndex + 1}`}</span>
			<span aria-hidden="true">Remove</span>
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
	/* `.field-label` and the input/select base reset live in the workspace-scoped
	   form-fields.css (under `.block-card`); only component-specific rules remain. */
	.field-row {
		display: flex;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
	}

	.field-row input {
		flex: 1;
		min-width: 0;
	}

	.field-error {
		margin: 0 0 var(--space-3);
		font-size: var(--text-sm);
		color: var(--color-danger);
	}

	/* Off-screen accessible name for the icon-style move/remove controls (WCAG 2.5.3);
	   the visible glyph beside it is aria-hidden. Component-scoped so it holds outside
	   the workspace layout too. */
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
