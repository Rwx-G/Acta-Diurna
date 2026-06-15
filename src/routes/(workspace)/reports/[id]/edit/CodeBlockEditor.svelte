<script lang="ts">
	import type { CodeBlock } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';

	// The code block edits the literal source in a monospace textarea, an optional
	// short language caption, and an optional list of annotations (a note plus an
	// optional 1-based line number). The source is stored verbatim - the renderer
	// escapes it and preserves whitespace. The shared BlockEditor frame supplies
	// the audience picker. No scale, no icon, no data binding.
	interface Props {
		block: CodeBlock;
		onEdit: () => void;
	}

	let { block = $bindable(), onEdit }: Props = $props();
</script>

<div class="code-editor">
	<label>
		Language (optional)
		<input
			value={block.language ?? ''}
			placeholder="e.g. bash, sql, json"
			oninput={(event) => {
				const value = event.currentTarget.value;
				if (value === '') delete block.language;
				else block.language = value;
				onEdit();
			}}
			aria-label="Code language"
		/>
	</label>

	<label>
		Code
		<textarea
			class="code-source"
			value={block.code}
			rows="8"
			spellcheck="false"
			oninput={(event) => {
				block.code = event.currentTarget.value;
				onEdit();
			}}
			aria-label="Code source"
		></textarea>
	</label>

	<p class="field-label">Annotations (optional)</p>
	{#each block.annotations ?? [] as annotation, annotationIndex (annotationIndex)}
		<div class="field-row">
			<input
				class="line-input"
				type="number"
				min="1"
				value={annotation.line ?? ''}
				placeholder="Line"
				oninput={(event) => {
					const value = event.currentTarget.value;
					const list = block.annotations;
					if (!list) return;
					if (value === '') delete list[annotationIndex].line;
					else list[annotationIndex].line = Number(value);
					onEdit();
				}}
				aria-label={`Annotation ${annotationIndex + 1} line`}
			/>
			<input
				value={annotation.text}
				placeholder="Note"
				oninput={(event) => {
					const list = block.annotations;
					if (list) list[annotationIndex].text = event.currentTarget.value;
					onEdit();
				}}
				aria-label={`Annotation ${annotationIndex + 1} text`}
			/>
			<Button
				class="row-control"
				variant="ghost"
				onclick={() => {
					block.annotations?.splice(annotationIndex, 1);
					if (block.annotations?.length === 0) delete block.annotations;
					onEdit();
				}}
				aria-label={`Remove annotation ${annotationIndex + 1}`}
			>
				<span aria-hidden="true">&times;</span>
			</Button>
		</div>
	{/each}
	<Button
		onclick={() => {
			block.annotations = [...(block.annotations ?? []), { text: '' }];
			onEdit();
		}}
	>
		Add annotation
	</Button>
</div>

<style>
	.code-editor {
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

	.field-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.field-row input:not(.line-input) {
		flex: 1 1 8rem;
		min-width: 0;
	}

	/* The shared `.block-card .field-row input` basis (form-fields.css) would otherwise
	   stretch this fixed line-number input; the compound selector outranks it so the line
	   field stays a narrow 5rem column. */
	.field-row input.line-input {
		flex: 0 0 5rem;
		width: 5rem;
	}

	.code-source {
		font-family: var(--font-mono);
		resize: vertical;
		white-space: pre;
	}

	input,
	textarea {
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
