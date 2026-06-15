<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Button from '$lib/ui/Button.svelte';

	// The inline remap form (Epic 10.5), shared by the block-level diagnostic
	// (BlockEditor) and the refill panel (RefillPanel) so a label / a11y change is
	// one edit. It posts the EXISTING `?/remap` action: the hidden fields carry the
	// block / data set / expected field, and the visible select picks the available
	// field to map onto. The caller passes its own `submit` enhance callback (each
	// surface reconciles its own state on success).
	interface Props {
		blockId: string;
		dataSetId: string;
		expectedField: string;
		suggested: string | null;
		fields: string[];
		disabled?: boolean;
		submit: SubmitFunction;
	}

	let {
		blockId,
		dataSetId,
		expectedField,
		suggested,
		fields,
		disabled = false,
		submit
	}: Props = $props();

	const noFields = $derived(fields.length === 0);
</script>

<form method="POST" action="?/remap" use:enhance={submit} class="remap">
	<input type="hidden" name="blockId" value={blockId} />
	<input type="hidden" name="dataSetId" value={dataSetId} />
	<input type="hidden" name="expectedField" value={expectedField} />
	<label class="remap-pick">
		Map to
		<select name="availableField" value={suggested ?? ''} disabled={noFields}>
			{#each fields as name (name)}
				<option value={name}>{name}</option>
			{/each}
		</select>
	</label>
	<Button type="submit" variant="secondary" disabled={disabled || noFields}>Remap</Button>
</form>

<style>
	.remap {
		display: flex;
		align-items: end;
		gap: var(--space-2);
		margin: 0;
	}

	.remap-pick {
		font-size: 12px;
	}
</style>
