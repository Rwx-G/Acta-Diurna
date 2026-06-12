<script lang="ts">
	import type { KpiBlock, KpiItem, KpiTrend } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';
	import BindingEditor from './BindingEditor.svelte';

	interface Props {
		block: KpiBlock;
		onEdit: () => void;
	}

	let { block = $bindable(), onEdit }: Props = $props();

	const KPI_TRENDS: KpiTrend[] = ['up', 'down', 'flat'];

	// Trend is optional: an empty selection deletes the field rather than
	// storing an empty string (optional fields are omitted, not blanked).
	function setKpiTrend(item: KpiItem, trend: string): void {
		if (trend === '') delete item.trend;
		else item.trend = trend as KpiTrend;
	}
</script>

{#each block.items ?? [] as item, itemIndex (itemIndex)}
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
			variant="ghost"
			onclick={() => {
				block.items!.splice(itemIndex, 1);
				if (block.items!.length === 0) delete block.items;
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
		(block.items ??= []).push({ label: '', value: '' });
		onEdit();
	}}
>
	Add item
</Button>
<BindingEditor bind:binding={block.binding} {onEdit} />

<style>
	.field-row {
		display: flex;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
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
</style>
