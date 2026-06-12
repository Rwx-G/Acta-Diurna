<script lang="ts">
	import type { Binding, BindingField } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';

	// Data-bound blocks (table/chart/kpi) may declare the fields they expect
	// from an upload. `dataSetId` resolution arrives with ingestion (Epic 2);
	// here the binding is editable as named expected fields only.
	interface Props {
		binding?: Binding;
		onEdit: () => void;
	}

	let { binding = $bindable(), onEdit }: Props = $props();

	const FIELD_TYPES: BindingField['type'][] = ['string', 'number', 'date', 'boolean'];

	function toggleBinding(enabled: boolean): void {
		binding = enabled ? { fields: [{ name: '', type: 'string' }] } : undefined;
		onEdit();
	}
</script>

<div class="binding">
	<label class="toggle">
		<input
			type="checkbox"
			checked={binding !== undefined}
			onchange={(event) => toggleBinding(event.currentTarget.checked)}
		/>
		Data binding (expected fields, resolved by data injection in Epic 2)
	</label>

	{#if binding}
		{@const fields = binding.fields}
		{#each fields as field, fieldIndex (fieldIndex)}
			<div class="field-row">
				<input
					value={field.name}
					placeholder="Field name"
					oninput={(event) => {
						field.name = event.currentTarget.value;
						onEdit();
					}}
					aria-label={`Binding field ${fieldIndex + 1} name`}
				/>
				<select
					value={field.type}
					onchange={(event) => {
						field.type = event.currentTarget.value as BindingField['type'];
						onEdit();
					}}
					aria-label={`Binding field ${fieldIndex + 1} type`}
				>
					{#each FIELD_TYPES as fieldType (fieldType)}
						<option value={fieldType}>{fieldType}</option>
					{/each}
				</select>
				<Button
					variant="danger"
					onclick={() => {
						fields.splice(fieldIndex, 1);
						onEdit();
					}}
					disabled={fields.length === 1}
					aria-label={`Remove binding field ${fieldIndex + 1}`}
				>
					Remove
				</Button>
			</div>
		{/each}
		<Button
			onclick={() => {
				fields.push({ name: '', type: 'string' });
				onEdit();
			}}
		>
			Add field
		</Button>
	{/if}
</div>

<style>
	.binding {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-top: var(--space-3);
		padding-top: var(--space-3);
		border-top: 1px dashed var(--color-ink-12);
	}

	.toggle {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 12px;
		color: var(--color-ink-65);
	}

	.field-row {
		display: flex;
		gap: var(--space-2);
	}

	.field-row input,
	.field-row select {
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
