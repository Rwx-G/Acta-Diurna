<script lang="ts">
	import type { TextBlock } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';
	import { paragraphText } from './editor-state';

	interface Props {
		block: TextBlock;
		sectionIndex: number;
		blockIndex: number;
		onEdit: () => void;
	}

	let { block = $bindable(), sectionIndex, blockIndex, onEdit }: Props = $props();
</script>

{#each block.paragraphs as paragraph, paragraphIndex (paragraphIndex)}
	<div class="paragraph-row">
		<textarea
			name={`paragraph:${sectionIndex}:${blockIndex}:${paragraphIndex}`}
			value={paragraphText(paragraph)}
			rows="3"
			oninput={(event) => {
				block.paragraphs[paragraphIndex] = [{ text: event.currentTarget.value }];
				onEdit();
			}}
			aria-label={`Paragraph ${paragraphIndex + 1}`}
		></textarea>
		<Button
			variant="ghost"
			onclick={() => {
				block.paragraphs.splice(paragraphIndex, 1);
				onEdit();
			}}
			disabled={block.paragraphs.length === 1}
			aria-label={`Remove paragraph ${paragraphIndex + 1}`}
		>
			Remove
		</Button>
	</div>
{/each}
<Button
	onclick={() => {
		block.paragraphs.push([{ text: '' }]);
		onEdit();
	}}
>
	Add paragraph
</Button>

<style>
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
</style>
