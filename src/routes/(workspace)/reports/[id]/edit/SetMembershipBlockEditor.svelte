<script lang="ts">
	import type { SetMembershipBlock } from '$lib/schema';
	import type { MatrixBlockOption } from './editor-state';

	// The set-membership block derives its UpSet entirely from a comparison-matrix
	// block it references by id - it re-enters no data. So this editor only chooses
	// the source `sourceBlockId` (a select of the document's comparison-matrix
	// blocks) and an optional `title`. The `matrixBlocks` prop is the document's
	// comparison-matrix blocks, threaded down so the select offers them. The shared
	// BlockEditor frame supplies the audience picker.
	interface Props {
		block: SetMembershipBlock;
		matrixBlocks?: MatrixBlockOption[];
		onEdit: () => void;
	}

	let { block = $bindable(), matrixBlocks, onEdit }: Props = $props();

	const matrixOptions = $derived(matrixBlocks ?? []);
</script>

<div class="set-membership-editor">
	<label>
		Source comparison matrix
		<select
			value={block.sourceBlockId}
			onchange={(event) => {
				block.sourceBlockId = event.currentTarget.value;
				onEdit();
			}}
			aria-label="Source comparison matrix"
		>
			<option value="">Select a comparison matrix</option>
			{#each matrixOptions as option (option.id)}
				<option value={option.id}>{option.label}</option>
			{/each}
		</select>
	</label>

	<label>
		Title (optional)
		<input
			value={block.title ?? ''}
			placeholder="Set-membership heading"
			oninput={(event) => {
				const value = event.currentTarget.value;
				if (value === '') delete block.title;
				else block.title = value;
				onEdit();
			}}
			aria-label="Set-membership title"
		/>
	</label>

	{#if matrixOptions.length === 0}
		<p class="hint">
			No comparison-matrix block in this document yet. Add a comparison matrix, then point this
			set-membership block at it: the UpSet derives entirely from that matrix's findings.
		</p>
	{/if}
</div>

<style>
	.set-membership-editor {
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

	/* `input` and `select` are the shared workspace base (form-fields.css). */

	.hint {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-ink-65);
	}
</style>
