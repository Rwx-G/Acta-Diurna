<script lang="ts">
	import type { CardGridBlock } from '$lib/schema';
	import { ICON_NAMES, MAX_CARD_COLUMNS } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';

	// The card grid is author-written prose (optional icon + title + description),
	// not bound data: the block has no `binding` field. Pick the desktop column
	// count, then add, edit and remove cards. Each card's icon is the optional 7.6
	// registry, by name. The shared BlockEditor frame supplies the audience picker.
	interface Props {
		block: CardGridBlock;
		onEdit: () => void;
	}

	let { block = $bindable(), onEdit }: Props = $props();

	const columnOptions = Array.from({ length: MAX_CARD_COLUMNS }, (_, index) => index + 1);
</script>

<div class="card-grid-editor">
	<label>
		Columns
		<select
			value={block.columns}
			onchange={(event) => {
				block.columns = Number(event.currentTarget.value);
				onEdit();
			}}
			aria-label="Card grid columns"
		>
			{#each columnOptions as count (count)}
				<option value={count}>{count}</option>
			{/each}
		</select>
	</label>

	{#each block.items as item, itemIndex (itemIndex)}
		<div class="card-row">
			<select
				value={item.icon ?? ''}
				onchange={(event) => {
					const value = event.currentTarget.value;
					if (value === '') delete item.icon;
					else item.icon = value as NonNullable<CardGridBlock['items'][number]['icon']>;
					onEdit();
				}}
				aria-label={`Card ${itemIndex + 1} icon`}
			>
				<option value="">No icon</option>
				{#each ICON_NAMES as name (name)}
					<option value={name}>{name}</option>
				{/each}
			</select>
			<input
				value={item.title}
				placeholder="Title"
				oninput={(event) => {
					item.title = event.currentTarget.value;
					onEdit();
				}}
				aria-label={`Card ${itemIndex + 1} title`}
			/>
			<input
				value={item.description}
				placeholder="Description"
				oninput={(event) => {
					item.description = event.currentTarget.value;
					onEdit();
				}}
				aria-label={`Card ${itemIndex + 1} description`}
			/>
			<Button
				variant="ghost"
				onclick={() => {
					block.items.splice(itemIndex, 1);
					onEdit();
				}}
				disabled={block.items.length === 1}
				aria-label={`Remove card ${itemIndex + 1}`}
			>
				Remove
			</Button>
		</div>
	{/each}

	<Button
		onclick={() => {
			block.items.push({ title: '', description: '' });
			onEdit();
		}}
	>
		Add card
	</Button>
</div>

<style>
	.card-grid-editor {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	label {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-ink-65);
	}

	.card-row {
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}

	.card-row input,
	.card-row select,
	label select {
		min-width: 0;
		padding: var(--space-2) var(--space-3);
		font: inherit;
		color: inherit;
		background: var(--color-surface);
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
	}

	.card-row input {
		flex: 1;
	}
</style>
