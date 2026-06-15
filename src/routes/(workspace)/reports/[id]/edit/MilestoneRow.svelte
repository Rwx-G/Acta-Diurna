<script lang="ts">
	import type { Milestone, Scale, Scales } from '$lib/schema';
	import { resolveScaleRef } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';
	import ParagraphsEditor from './ParagraphsEditor.svelte';

	// One timeline milestone row, extracted from TimelineBlockEditor (Story 10.4 QA
	// remediation, perf). The entry-option lookup is a `$derived` so `resolveScaleRef`
	// memoizes per milestone: it re-runs only when this milestone's `status.scaleRef`
	// or the document `scales` change, NOT on every label/date keystroke (the
	// `{@const entryOptions = ...}` in the parent render loop re-evaluated the lookup
	// for every milestone on each keystroke). The parent owns the array operations
	// (move / remove / add) and threads them down as callbacks.
	interface Props {
		milestone: Milestone;
		milestoneIndex: number;
		scales?: Scales;
		scaleOptions: Scale[];
		canMoveUp: boolean;
		canMoveDown: boolean;
		canRemove: boolean;
		onMoveUp: () => void;
		onMoveDown: () => void;
		onRemove: () => void;
		onEdit: () => void;
	}

	let {
		milestone = $bindable(),
		milestoneIndex,
		scales,
		scaleOptions,
		canMoveUp,
		canMoveDown,
		canRemove,
		onMoveUp,
		onMoveDown,
		onRemove,
		onEdit
	}: Props = $props();

	const entryOptions = $derived(resolveScaleRef(scales, milestone.status.scaleRef)?.entries ?? []);
</script>

<div class="milestone">
	<div class="milestone-head">
		<input
			value={milestone.label}
			placeholder="Milestone label"
			oninput={(event) => {
				milestone.label = event.currentTarget.value;
				onEdit();
			}}
			aria-label={`Milestone ${milestoneIndex + 1} label`}
		/>
		<Button onclick={onMoveUp} disabled={!canMoveUp}>
			<span class="sr-only">{`Move milestone ${milestoneIndex + 1} up`}</span>
			<span aria-hidden="true">Up</span>
		</Button>
		<Button onclick={onMoveDown} disabled={!canMoveDown}>
			<span class="sr-only">{`Move milestone ${milestoneIndex + 1} down`}</span>
			<span aria-hidden="true">Down</span>
		</Button>
		<Button
			variant="ghost"
			onclick={onRemove}
			disabled={!canRemove}
			aria-label={`Remove milestone ${milestoneIndex + 1}`}
		>
			Remove
		</Button>
	</div>

	<label>
		Date (optional)
		<input
			value={milestone.date ?? ''}
			placeholder="e.g. Q3 2026"
			oninput={(event) => {
				const value = event.currentTarget.value;
				if (value === '') delete milestone.date;
				else milestone.date = value;
				onEdit();
			}}
			aria-label={`Milestone ${milestoneIndex + 1} date`}
		/>
	</label>

	<div class="status-row">
		<label>
			Status scale
			<select
				value={milestone.status.scaleRef}
				onchange={(event) => {
					milestone.status.scaleRef = event.currentTarget.value;
					milestone.status.entry = '';
					onEdit();
				}}
				aria-label={`Milestone ${milestoneIndex + 1} status scale`}
			>
				<option value="">Select a scale</option>
				{#each scaleOptions as scale (scale.key)}
					<option value={scale.key}>{scale.label}</option>
				{/each}
			</select>
		</label>
		<label>
			Status
			<select
				value={milestone.status.entry}
				onchange={(event) => {
					milestone.status.entry = event.currentTarget.value;
					onEdit();
				}}
				aria-label={`Milestone ${milestoneIndex + 1} status`}
			>
				<option value="">Select a status</option>
				{#each entryOptions as entry (entry.key)}
					<option value={entry.key}>{entry.label}</option>
				{/each}
			</select>
		</label>
	</div>

	{#if milestone.detail}
		<ParagraphsEditor
			bind:paragraphs={milestone.detail}
			label={`Milestone ${milestoneIndex + 1} detail`}
			{onEdit}
		/>
		<Button
			variant="ghost"
			onclick={() => {
				delete milestone.detail;
				onEdit();
			}}
			aria-label={`Remove milestone ${milestoneIndex + 1} detail`}
		>
			Remove detail
		</Button>
	{:else}
		<Button
			onclick={() => {
				milestone.detail = [[{ text: '' }]];
				onEdit();
			}}
			aria-label={`Add detail to milestone ${milestoneIndex + 1}`}
		>
			Add detail
		</Button>
	{/if}
</div>

<style>
	.milestone {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		background: var(--color-surface);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-sm);
	}

	label {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-ink-65);
	}

	.milestone-head {
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}

	.milestone-head input {
		flex: 1;
	}

	.status-row {
		display: flex;
		gap: var(--space-2);
	}

	.status-row label {
		flex: 1;
		min-width: 0;
	}

	/* The `input, select` reset and `.sr-only` are the shared workspace base
	   (form-fields.css + sr-only.css). */
</style>
