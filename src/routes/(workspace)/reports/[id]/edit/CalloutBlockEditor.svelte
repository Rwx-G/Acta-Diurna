<script lang="ts">
	import type { CalloutBlock } from '$lib/schema';
	import { CALLOUT_TONES, ICON_NAMES } from '$lib/schema';
	import ParagraphsEditor from './ParagraphsEditor.svelte';

	// The callout picks a tone (the closed enum), an optional icon (the 7.6
	// registry, by name) and an optional kicker, then edits the rich-text body as
	// inline RUNS through the shared ParagraphsEditor (Story 10.4) - the SAME
	// run-level editor the text block uses, so the callout's bold / italic /
	// inline-code / link marks are editable in place and the preview reflects them
	// (no more flatten-on-edit, no freeform HTML). The body is required (at least one
	// paragraph), so the inner Remove control floors at one. The shared BlockEditor
	// frame supplies the audience picker. No scale: the tone colour is theme-owned.
	interface Props {
		block: CalloutBlock;
		onEdit: () => void;
	}

	let { block = $bindable(), onEdit }: Props = $props();
</script>

<div class="callout-editor">
	<label>
		Tone
		<select
			value={block.tone}
			onchange={(event) => {
				block.tone = event.currentTarget.value as CalloutBlock['tone'];
				onEdit();
			}}
			aria-label="Callout tone"
		>
			{#each CALLOUT_TONES as tone (tone)}
				<option value={tone}>{tone}</option>
			{/each}
		</select>
	</label>

	<label>
		Icon (optional)
		<select
			value={block.icon ?? ''}
			onchange={(event) => {
				const value = event.currentTarget.value;
				if (value === '') delete block.icon;
				else block.icon = value as CalloutBlock['icon'];
				onEdit();
			}}
			aria-label="Callout icon"
		>
			<option value="">No icon</option>
			{#each ICON_NAMES as name (name)}
				<option value={name}>{name}</option>
			{/each}
		</select>
	</label>

	<label>
		Kicker (optional)
		<input
			value={block.kicker ?? ''}
			placeholder="Header label"
			oninput={(event) => {
				const value = event.currentTarget.value;
				if (value === '') delete block.kicker;
				else block.kicker = value;
				onEdit();
			}}
			aria-label="Callout kicker"
		/>
	</label>

	<p class="field-label">Body</p>
	<ParagraphsEditor bind:paragraphs={block.body} label="Callout body" {onEdit} />
</div>

<style>
	.callout-editor {
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

	.field-label {
		margin: var(--space-2) 0 0;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-ink-65);
	}

	input,
	select {
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
