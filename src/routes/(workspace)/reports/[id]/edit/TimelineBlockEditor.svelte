<script lang="ts">
	import type { TimelineBlock } from '$lib/schema';
	import { resolveScaleRef } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';
	import { paragraphText } from './editor-state';

	// The timeline adds, edits and removes ordered milestones. Each milestone
	// carries a `label`, an optional `date`/phase sub-label, an optional rich-text
	// `detail` (edited as plain-text paragraphs - the same flatten-on-edit the
	// callout and list editors use), and a `status` ({ scaleRef, entry }) picked
	// from the document scales: the scale select offers the declared scales, the
	// entry select offers that scale's entries by key (label shown). The `scales`
	// prop is the document's scales, threaded down so the selects offer the declared
	// scales. The shared BlockEditor frame supplies the audience picker.
	import type { Scales } from '$lib/schema';

	interface Props {
		block: TimelineBlock;
		scales?: Scales;
		onEdit: () => void;
	}

	let { block = $bindable(), scales, onEdit }: Props = $props();

	const scaleOptions = $derived(scales ?? []);
</script>

<div class="timeline-editor">
	<label>
		Title (optional)
		<input
			value={block.title ?? ''}
			placeholder="Timeline heading"
			oninput={(event) => {
				const value = event.currentTarget.value;
				if (value === '') delete block.title;
				else block.title = value;
				onEdit();
			}}
			aria-label="Timeline title"
		/>
	</label>

	{#each block.milestones as milestone, milestoneIndex (milestoneIndex)}
		{@const entryOptions = resolveScaleRef(scales, milestone.status.scaleRef)?.entries ?? []}
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
				<Button
					variant="ghost"
					onclick={() => {
						block.milestones.splice(milestoneIndex, 1);
						onEdit();
					}}
					disabled={block.milestones.length === 1}
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
				{#each milestone.detail as paragraph, paragraphIndex (paragraphIndex)}
					<div class="field-row">
						<textarea
							value={paragraphText(paragraph)}
							rows="2"
							oninput={(event) => {
								milestone.detail![paragraphIndex] = [{ text: event.currentTarget.value }];
								onEdit();
							}}
							aria-label={`Milestone ${milestoneIndex + 1} detail paragraph ${paragraphIndex + 1}`}
						></textarea>
						<Button
							variant="ghost"
							onclick={() => {
								milestone.detail!.splice(paragraphIndex, 1);
								if (milestone.detail!.length === 0) delete milestone.detail;
								onEdit();
							}}
							aria-label={`Remove milestone ${milestoneIndex + 1} detail paragraph ${paragraphIndex + 1}`}
						>
							Remove
						</Button>
					</div>
				{/each}
			{/if}
			<Button
				onclick={() => {
					if (milestone.detail) milestone.detail.push([{ text: '' }]);
					else milestone.detail = [[{ text: '' }]];
					onEdit();
				}}
				aria-label={`Add detail paragraph to milestone ${milestoneIndex + 1}`}
			>
				Add detail paragraph
			</Button>
		</div>
	{/each}

	<Button
		onclick={() => {
			block.milestones.push({ label: '', status: { scaleRef: '', entry: '' } });
			onEdit();
		}}
	>
		Add milestone
	</Button>

	{#if scaleOptions.length === 0}
		<p class="hint">
			No document scales declared yet. Add a scale to the document to populate the status selects.
		</p>
	{/if}
</div>

<style>
	.timeline-editor {
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

	.milestone {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		background: var(--color-surface);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-sm);
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

	.field-row {
		display: flex;
		gap: var(--space-2);
	}

	.field-row textarea {
		flex: 1;
		min-width: 0;
		resize: vertical;
	}

	input,
	select,
	textarea {
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

	.hint {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-ink-65);
	}
</style>
