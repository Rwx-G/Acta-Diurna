<script lang="ts">
	import type { ListBlock } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';
	import ParagraphsEditor from './ParagraphsEditor.svelte';

	// The list picks ordered (a numbered procedure / steps list) or unordered, then
	// adds, edits and removes items. Each item carries a lead `term` and an OPTIONAL
	// rich-text `description` edited as inline RUNS through the shared ParagraphsEditor
	// (Story 10.4) - the SAME run-level editor the text and callout blocks use, so the
	// description's bold / italic / inline-code / link marks are editable in place (no
	// more flatten-on-edit, no freeform HTML). At least one of term / description is
	// required per item (the schema rule); the description is added and removed as a
	// whole (the "Add description" / "Remove description" controls), and while present
	// the inner Remove floors at one paragraph. The shared BlockEditor frame supplies
	// the audience picker.
	interface Props {
		block: ListBlock;
		onEdit: () => void;
	}

	let { block = $bindable(), onEdit }: Props = $props();
</script>

<div class="list-editor">
	<label>
		Order
		<select
			value={block.ordered ? 'ordered' : 'unordered'}
			onchange={(event) => {
				block.ordered = event.currentTarget.value === 'ordered';
				onEdit();
			}}
			aria-label="List order"
		>
			<option value="ordered">Ordered (numbered steps)</option>
			<option value="unordered">Unordered</option>
		</select>
	</label>

	{#each block.items as item, itemIndex (itemIndex)}
		<div class="item">
			<div class="item-head">
				<input
					value={item.term ?? ''}
					placeholder="Term (lead label)"
					oninput={(event) => {
						const value = event.currentTarget.value;
						if (value === '') delete item.term;
						else item.term = value;
						onEdit();
					}}
					aria-label={`Item ${itemIndex + 1} term`}
				/>
				<Button
					variant="ghost"
					onclick={() => {
						block.items.splice(itemIndex, 1);
						onEdit();
					}}
					disabled={block.items.length === 1}
					aria-label={`Remove item ${itemIndex + 1}`}
				>
					Remove
				</Button>
			</div>

			{#if item.description}
				<ParagraphsEditor
					bind:paragraphs={item.description}
					label={`Item ${itemIndex + 1} description`}
					{onEdit}
				/>
				<Button
					variant="ghost"
					onclick={() => {
						delete item.description;
						onEdit();
					}}
					aria-label={`Remove item ${itemIndex + 1} description`}
				>
					Remove description
				</Button>
			{:else}
				<Button
					onclick={() => {
						item.description = [[{ text: '' }]];
						onEdit();
					}}
					aria-label={`Add description to item ${itemIndex + 1}`}
				>
					Add description
				</Button>
			{/if}
		</div>
	{/each}

	<Button
		onclick={() => {
			block.items.push({ term: '' });
			onEdit();
		}}
	>
		Add item
	</Button>
</div>

<style>
	.list-editor {
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

	.item {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		background: var(--color-surface);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-sm);
	}

	.item-head {
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}

	.item-head input {
		flex: 1;
	}

	input,
	select {
		min-width: 0;
		padding: var(--space-2) var(--space-3);
		font: inherit;
		font-weight: 400;
		line-height: 1.5;
		color: inherit;
		background: var(--color-surface);
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
	}
</style>
