<script lang="ts">
	import type { ChartBlock, ChartKind } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';
	import BindingEditor from './BindingEditor.svelte';

	interface Props {
		block: ChartBlock;
		onEdit: () => void;
	}

	let { block = $bindable(), onEdit }: Props = $props();

	const CHART_KINDS: ChartKind[] = ['line', 'bar', 'area', 'pie'];
</script>

<label class="field-label" for={`chart-kind-${block.id}`}>Kind</label>
<select
	id={`chart-kind-${block.id}`}
	value={block.kind}
	onchange={(event) => {
		block.kind = event.currentTarget.value as ChartKind;
		onEdit();
	}}
>
	{#each CHART_KINDS as kind (kind)}
		<option value={kind}>{kind}</option>
	{/each}
</select>

{#each block.series ?? [] as series, seriesIndex (seriesIndex)}
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
				variant="ghost"
				onclick={() => {
					block.series!.splice(seriesIndex, 1);
					if (block.series!.length === 0) delete block.series;
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
						// A blank or non-numeric input yields NaN; keep the stored
						// y a finite number so the document stays schema-valid.
						point.y = Number.isFinite(value) ? value : 0;
						onEdit();
					}}
					aria-label={`Series ${seriesIndex + 1} point ${pointIndex + 1} y`}
				/>
				<Button
					variant="ghost"
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
		(block.series ??= []).push({
			name: `Series ${(block.series?.length ?? 0) + 1}`,
			points: []
		});
		onEdit();
	}}
>
	Add series
</Button>
<BindingEditor bind:binding={block.binding} {onEdit} />

<style>
	.field-label {
		display: block;
		margin: var(--space-4) 0 var(--space-2);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-ink-65);
	}

	.field-row {
		display: flex;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
	}

	.series {
		margin: var(--space-4) 0;
		padding: var(--space-3) var(--space-4);
		border: 1px dashed var(--color-ink-12);
		border-radius: var(--radius-sm);
	}

	input,
	select {
		padding: var(--space-2) var(--space-3);
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
