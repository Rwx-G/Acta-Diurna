<script lang="ts">
	import type { FieldGridBlock } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';

	// The field grid is author-written metadata (label/value pairs), not bound
	// data: the block has no `binding` field. Add, edit and remove items. The
	// shared BlockEditor frame supplies the audience picker, so this editor carries
	// none of its own.
	interface Props {
		block: FieldGridBlock;
		onEdit: () => void;
	}

	let { block = $bindable(), onEdit }: Props = $props();
</script>

<div class="field-grid-editor">
	<label class="layout-toggle">
		Layout
		<select
			value={block.layout ?? 'grid'}
			onchange={(event) => {
				const value = event.currentTarget.value;
				if (value === 'grid') delete block.layout;
				else block.layout = 'strip';
				onEdit();
			}}
			aria-label="Field grid layout"
		>
			<option value="grid">Grid (two columns)</option>
			<option value="strip">Strip (centred meta-strip)</option>
		</select>
	</label>

	{#each block.items as item, itemIndex (itemIndex)}
		<div class="field-row">
			<input
				value={item.label}
				placeholder="Label"
				oninput={(event) => {
					item.label = event.currentTarget.value;
					onEdit();
				}}
				aria-label={`Field ${itemIndex + 1} label`}
			/>
			<input
				value={item.value}
				placeholder="Value"
				oninput={(event) => {
					item.value = event.currentTarget.value;
					onEdit();
				}}
				aria-label={`Field ${itemIndex + 1} value`}
			/>
			<Button
				class="row-control"
				variant="ghost"
				onclick={() => {
					block.items.splice(itemIndex, 1);
					onEdit();
				}}
				disabled={block.items.length === 1}
				aria-label={`Remove field ${itemIndex + 1}`}
			>
				<span aria-hidden="true">&times;</span>
			</Button>
		</div>
	{/each}

	<Button
		onclick={() => {
			block.items.push({ label: '', value: '' });
			onEdit();
		}}
	>
		Add field
	</Button>
</div>

<style>
	.layout-toggle {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-bottom: var(--space-3);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-ink-65);
	}

	.layout-toggle select {
		padding: var(--space-2) var(--space-3);
		font: inherit;
		font-weight: 400;
		color: inherit;
		background: var(--color-surface);
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
	}

	.field-row {
		display: flex;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
		align-items: center;
	}

	.field-row input {
		flex: 1 1 8rem;
		min-width: 0;
		padding: var(--space-2) var(--space-3);
		font: inherit;
		color: inherit;
		background: var(--color-surface);
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
	}
</style>
