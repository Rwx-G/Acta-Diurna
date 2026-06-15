<script lang="ts">
	import type { KpiBlock, KpiItem, KpiTrend } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';
	import BindingEditor from './BindingEditor.svelte';
	import { moveItem } from './editor-state';

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
			onclick={() => {
				moveItem(block.items!, itemIndex, -1);
				onEdit();
			}}
			disabled={itemIndex === 0}
		>
			<span class="sr-only">{`Move KPI ${itemIndex + 1} up`}</span>
			<span aria-hidden="true">Up</span>
		</Button>
		<Button
			onclick={() => {
				moveItem(block.items!, itemIndex, 1);
				onEdit();
			}}
			disabled={itemIndex === (block.items?.length ?? 0) - 1}
		>
			<span class="sr-only">{`Move KPI ${itemIndex + 1} down`}</span>
			<span aria-hidden="true">Down</span>
		</Button>
		<Button
			variant="ghost"
			onclick={() => {
				block.items!.splice(itemIndex, 1);
				if (block.items!.length === 0) delete block.items;
				onEdit();
			}}
		>
			<span class="sr-only">{`Remove KPI ${itemIndex + 1}`}</span>
			<span aria-hidden="true">Remove</span>
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
	/* The input/select base reset lives in the workspace-scoped form-fields.css
	   (under `.block-card`); only component-specific rules remain. */
	.field-row {
		display: flex;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
	}

	.field-row input {
		flex: 1;
		min-width: 0;
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
