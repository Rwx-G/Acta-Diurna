<script lang="ts">
	import { AUDIENCES, type Audience } from '$lib/schema';

	// Sections and blocks share the same optional `audiences` field; the field
	// is bound so toggles write straight into the document state.
	interface Props {
		audiences?: Audience[];
		legend: string;
		onEdit: () => void;
	}

	let { audiences = $bindable(), legend, onEdit }: Props = $props();

	function toggle(tag: Audience, checked: boolean): void {
		const selected = AUDIENCES.filter((candidate) =>
			candidate === tag ? checked : (audiences?.includes(candidate) ?? false)
		);
		// Optional fields are omitted when empty, not stored as [] (format rule).
		audiences = selected.length === 0 ? undefined : selected;
		onEdit();
	}
</script>

<fieldset class="audiences">
	<legend>{legend}</legend>
	{#each AUDIENCES as tag (tag)}
		<label>
			<input
				type="checkbox"
				checked={audiences?.includes(tag) ?? false}
				onchange={(event) => toggle(tag, event.currentTarget.checked)}
			/>
			{tag}
		</label>
	{/each}
</fieldset>

<style>
	.audiences {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		margin: 0 0 var(--space-3);
		padding: var(--space-1) var(--space-3);
		border: 1px dashed var(--color-ink-12);
		border-radius: var(--radius-sm);
	}

	legend {
		padding: 0 var(--space-1);
		font-size: 12px;
		color: var(--color-ink-65);
	}

	label {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-size: 12px;
		text-transform: capitalize;
	}
</style>
