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

	// Quiet one-line state for the collapsed disclosure: no selection means the
	// block shows to every audience level, so "all" reads truer than "none".
	const stateLabel = $derived(
		audiences && audiences.length > 0 && audiences.length < AUDIENCES.length
			? audiences.join(', ')
			: 'all'
	);
</script>

<details class="audiences">
	<summary>
		<span class="legend">{legend}:</span>
		<span class="state">{stateLabel}</span>
	</summary>
	<div class="options" role="group" aria-label={legend}>
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
	</div>
</details>

<style>
	.audiences {
		margin: 0 0 var(--space-3);
		padding: var(--space-1) var(--space-3);
		border: 1px dashed var(--color-ink-12);
		border-radius: var(--radius-sm);
	}

	summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		color: var(--color-ink-65);
		cursor: pointer;
		list-style: none;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	summary::before {
		content: '\25B8';
		font-size: var(--text-xs);
		color: var(--color-ink-65);
	}

	.audiences[open] summary::before {
		content: '\25BE';
	}

	.legend {
		font-weight: 600;
	}

	.state {
		text-transform: capitalize;
	}

	.options {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		margin-top: var(--space-2);
	}

	label {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--text-sm);
		text-transform: capitalize;
	}
</style>
