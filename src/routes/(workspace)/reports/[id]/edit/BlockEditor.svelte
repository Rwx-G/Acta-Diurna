<script lang="ts">
	import type { Block, ChartKind, KpiItem, KpiTrend, TableBlock } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';
	import AudiencePicker from './AudiencePicker.svelte';
	import BindingEditor from './BindingEditor.svelte';
	import { paragraphText, type EditorIssue } from './editor-state';

	interface Props {
		block: Block;
		sectionIndex: number;
		blockIndex: number;
		count: number;
		issues: EditorIssue[];
		onEdit: () => void;
		onRemove: () => void;
		onMove: (direction: -1 | 1) => void;
	}

	let {
		block = $bindable(),
		sectionIndex,
		blockIndex,
		count,
		issues,
		onEdit,
		onRemove,
		onMove
	}: Props = $props();

	const CHART_KINDS: ChartKind[] = ['line', 'bar', 'area', 'pie'];
	const KPI_TRENDS: KpiTrend[] = ['up', 'down', 'flat'];

	function renameColumnKey(table: TableBlock, columnIndex: number, key: string): void {
		const oldKey = table.columns[columnIndex].key;
		if (key === oldKey) return;
		table.columns[columnIndex].key = key;
		// Static rows are keyed by column key: migrate values so a rename never
		// silently orphans a column of data.
		for (const row of table.rows ?? []) {
			if (oldKey in row) {
				row[key] = row[oldKey];
				delete row[oldKey];
			}
		}
	}

	function removeColumn(table: TableBlock, columnIndex: number): void {
		const key = table.columns[columnIndex].key;
		table.columns.splice(columnIndex, 1);
		for (const row of table.rows ?? []) {
			delete row[key];
		}
	}

	function setKpiTrend(item: KpiItem, trend: string): void {
		if (trend === '') delete item.trend;
		else item.trend = trend as KpiTrend;
	}
</script>

<article class="block-card" aria-label={`${block.type} block`}>
	<header>
		<span class="block-type">{block.type}</span>
		<div class="controls">
			<Button onclick={() => onMove(-1)} disabled={blockIndex === 0} aria-label="Move block up">
				Up
			</Button>
			<Button
				onclick={() => onMove(1)}
				disabled={blockIndex === count - 1}
				aria-label="Move block down"
			>
				Down
			</Button>
			<Button variant="danger" onclick={onRemove} aria-label="Remove block">Remove</Button>
		</div>
	</header>

	{#if issues.length > 0}
		<ul class="block-issues" role="alert">
			{#each issues as issue (issue.path + issue.message)}
				<li>
					<strong>{issue.message}</strong>
					{#if issue.hint}<span class="hint">{issue.hint}</span>{/if}
					<code class="path">{issue.path}</code>
				</li>
			{/each}
		</ul>
	{/if}

	<AudiencePicker bind:audiences={block.audiences} legend="Block audiences" {onEdit} />

	{#if block.type === 'text'}
		{@const textBlock = block}
		{#each textBlock.paragraphs as paragraph, paragraphIndex (paragraphIndex)}
			<div class="paragraph-row">
				<textarea
					name={`paragraph:${sectionIndex}:${blockIndex}:${paragraphIndex}`}
					value={paragraphText(paragraph)}
					rows="3"
					oninput={(event) => {
						textBlock.paragraphs[paragraphIndex] = [{ text: event.currentTarget.value }];
						onEdit();
					}}
					aria-label={`Paragraph ${paragraphIndex + 1}`}
				></textarea>
				<Button
					variant="danger"
					onclick={() => {
						textBlock.paragraphs.splice(paragraphIndex, 1);
						onEdit();
					}}
					disabled={textBlock.paragraphs.length === 1}
					aria-label={`Remove paragraph ${paragraphIndex + 1}`}
				>
					Remove
				</Button>
			</div>
		{/each}
		<Button
			onclick={() => {
				textBlock.paragraphs.push([{ text: '' }]);
				onEdit();
			}}
		>
			Add paragraph
		</Button>
	{:else if block.type === 'table'}
		{@const tableBlock = block}
		<p class="field-label">Columns</p>
		{#each tableBlock.columns as column, columnIndex (columnIndex)}
			<div class="field-row">
				<input
					value={column.key}
					placeholder="key"
					oninput={(event) => {
						renameColumnKey(tableBlock, columnIndex, event.currentTarget.value);
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
						removeColumn(tableBlock, columnIndex);
						onEdit();
					}}
					disabled={tableBlock.columns.length === 1}
					aria-label={`Remove column ${columnIndex + 1}`}
				>
					Remove
				</Button>
			</div>
		{/each}
		<Button
			onclick={() => {
				tableBlock.columns.push({
					key: `column-${tableBlock.columns.length + 1}`,
					label: `Column ${tableBlock.columns.length + 1}`
				});
				onEdit();
			}}
		>
			Add column
		</Button>

		<p class="field-label">Static rows</p>
		{#each tableBlock.rows ?? [] as row, rowIndex (rowIndex)}
			<div class="field-row">
				{#each tableBlock.columns as column (column.key)}
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
						tableBlock.rows?.splice(rowIndex, 1);
						if (tableBlock.rows?.length === 0) delete tableBlock.rows;
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
				const row = Object.fromEntries(tableBlock.columns.map((column) => [column.key, '']));
				(tableBlock.rows ??= []).push(row);
				onEdit();
			}}
		>
			Add row
		</Button>
		<BindingEditor bind:binding={tableBlock.binding} {onEdit} />
	{:else if block.type === 'chart'}
		{@const chartBlock = block}
		<label class="field-label" for={`chart-kind-${chartBlock.id}`}>Kind</label>
		<select
			id={`chart-kind-${chartBlock.id}`}
			value={chartBlock.kind}
			onchange={(event) => {
				chartBlock.kind = event.currentTarget.value as ChartKind;
				onEdit();
			}}
		>
			{#each CHART_KINDS as kind (kind)}
				<option value={kind}>{kind}</option>
			{/each}
		</select>

		{#each chartBlock.series ?? [] as series, seriesIndex (seriesIndex)}
			<div class="series">
				<div class="field-row">
					<input
						value={series.name}
						placeholder="Series name"
						oninput={(event) => {
							series.name = event.currentTarget.value;
							onEdit();
						}}
						aria-label={`Series ${seriesIndex + 1} name`}
					/>
					<Button
						variant="danger"
						onclick={() => {
							chartBlock.series?.splice(seriesIndex, 1);
							if (chartBlock.series?.length === 0) delete chartBlock.series;
							onEdit();
						}}
						aria-label={`Remove series ${seriesIndex + 1}`}
					>
						Remove
					</Button>
				</div>
				{#each series.points as point, pointIndex (pointIndex)}
					<div class="field-row">
						<input
							value={String(point.x)}
							placeholder="x"
							oninput={(event) => {
								point.x = event.currentTarget.value;
								onEdit();
							}}
							aria-label={`Series ${seriesIndex + 1} point ${pointIndex + 1} x`}
						/>
						<input
							type="number"
							value={point.y}
							oninput={(event) => {
								const value = event.currentTarget.valueAsNumber;
								point.y = Number.isFinite(value) ? value : 0;
								onEdit();
							}}
							aria-label={`Series ${seriesIndex + 1} point ${pointIndex + 1} y`}
						/>
						<Button
							variant="danger"
							onclick={() => {
								series.points.splice(pointIndex, 1);
								onEdit();
							}}
							aria-label={`Remove point ${pointIndex + 1}`}
						>
							Remove
						</Button>
					</div>
				{/each}
				<Button
					onclick={() => {
						series.points.push({ x: '', y: 0 });
						onEdit();
					}}
				>
					Add point
				</Button>
			</div>
		{/each}
		<Button
			onclick={() => {
				(chartBlock.series ??= []).push({
					name: `Series ${(chartBlock.series?.length ?? 0) + 1}`,
					points: []
				});
				onEdit();
			}}
		>
			Add series
		</Button>
		<BindingEditor bind:binding={chartBlock.binding} {onEdit} />
	{:else if block.type === 'kpi'}
		{@const kpiBlock = block}
		{#each kpiBlock.items ?? [] as item, itemIndex (itemIndex)}
			<div class="field-row">
				<input
					value={item.label}
					placeholder="Label"
					oninput={(event) => {
						item.label = event.currentTarget.value;
						onEdit();
					}}
					aria-label={`KPI ${itemIndex + 1} label`}
				/>
				<input
					value={String(item.value)}
					placeholder="Value"
					oninput={(event) => {
						item.value = event.currentTarget.value;
						onEdit();
					}}
					aria-label={`KPI ${itemIndex + 1} value`}
				/>
				<input
					value={item.unit ?? ''}
					placeholder="Unit (optional)"
					oninput={(event) => {
						const value = event.currentTarget.value;
						if (value === '') delete item.unit;
						else item.unit = value;
						onEdit();
					}}
					aria-label={`KPI ${itemIndex + 1} unit`}
				/>
				<select
					value={item.trend ?? ''}
					onchange={(event) => {
						setKpiTrend(item, event.currentTarget.value);
						onEdit();
					}}
					aria-label={`KPI ${itemIndex + 1} trend`}
				>
					<option value="">no trend</option>
					{#each KPI_TRENDS as trend (trend)}
						<option value={trend}>{trend}</option>
					{/each}
				</select>
				<Button
					variant="danger"
					onclick={() => {
						kpiBlock.items?.splice(itemIndex, 1);
						if (kpiBlock.items?.length === 0) delete kpiBlock.items;
						onEdit();
					}}
					aria-label={`Remove KPI ${itemIndex + 1}`}
				>
					Remove
				</Button>
			</div>
		{/each}
		<Button
			onclick={() => {
				(kpiBlock.items ??= []).push({ label: '', value: '' });
				onEdit();
			}}
		>
			Add item
		</Button>
		<BindingEditor bind:binding={kpiBlock.binding} {onEdit} />
	{:else if block.type === 'image'}
		{@const imageBlock = block}
		<label class="field-label" for={`image-asset-${imageBlock.id}`}>Asset</label>
		<input
			id={`image-asset-${imageBlock.id}`}
			value={imageBlock.assetId}
			disabled
			placeholder="Asset UUID"
		/>
		<p class="note">Uploads arrive with data injection (Epic 2); an existing asset id is kept.</p>
		<label class="field-label" for={`image-alt-${imageBlock.id}`}>Alt text (required)</label>
		<input
			id={`image-alt-${imageBlock.id}`}
			value={imageBlock.alt}
			oninput={(event) => {
				imageBlock.alt = event.currentTarget.value;
				onEdit();
			}}
		/>
		<label class="field-label" for={`image-caption-${imageBlock.id}`}>Caption (optional)</label>
		<input
			id={`image-caption-${imageBlock.id}`}
			value={imageBlock.caption ?? ''}
			oninput={(event) => {
				const value = event.currentTarget.value;
				if (value === '') delete imageBlock.caption;
				else imageBlock.caption = value;
				onEdit();
			}}
		/>
	{/if}
</article>

<style>
	.block-card {
		margin-bottom: var(--space-3);
		padding: var(--space-3) var(--space-4);
		background: var(--color-stone);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-sm);
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-2);
	}

	.block-type {
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-ink-65);
	}

	.controls {
		display: flex;
		gap: var(--space-1);
	}

	.block-issues {
		margin: 0 0 var(--space-3);
		padding: var(--space-2) var(--space-5);
		color: var(--color-danger);
		background: var(--color-danger-08);
		border-radius: var(--radius-sm);
	}

	.block-issues .hint {
		display: block;
		color: var(--color-ink-65);
	}

	.block-issues .path {
		display: block;
		font-size: 11px;
		color: var(--color-ink-65);
	}

	.paragraph-row {
		display: flex;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}

	textarea {
		flex: 1;
		min-width: 0;
		padding: var(--space-2) var(--space-3);
		font: inherit;
		color: inherit;
		background: var(--color-surface);
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
		resize: vertical;
	}

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

	.series {
		margin: var(--space-3) 0;
		padding: var(--space-2) var(--space-3);
		border: 1px dashed var(--color-ink-12);
		border-radius: var(--radius-sm);
	}

	input,
	select {
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

	input:disabled {
		color: var(--color-ink-65);
		background: var(--color-ink-12);
	}

	.note {
		margin: var(--space-1) 0 0;
		font-size: 12px;
		color: var(--color-ink-65);
	}
</style>
