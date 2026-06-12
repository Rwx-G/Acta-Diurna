<script lang="ts">
	import type {
		ComparisonMatrixBlock,
		Finding,
		Scales,
		SourceState,
		TreatmentStatus
	} from '$lib/schema';
	import { resolveScaleRef } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';

	// The comparison-matrix is authored as structured JSON in the document (epic:
	// findings are NOT routed through the 2.4 flat-CSV binding path). The block has
	// no `binding` field. The `scales` prop is the document's scales, threaded
	// down so the severity/source selects offer the declared entry keys.
	interface Props {
		block: ComparisonMatrixBlock;
		scales?: Scales;
		onEdit: () => void;
	}

	let { block = $bindable(), scales, onEdit }: Props = $props();

	const scaleOptions = $derived(scales ?? []);
	const severityEntries = $derived(resolveScaleRef(scales, block.severityScale)?.entries ?? []);
	const sourceEntries = $derived(resolveScaleRef(scales, block.sourceScale)?.entries ?? []);

	const SOURCE_STATES: { value: SourceState; label: string }[] = [
		{ value: 'found', label: 'Found' },
		{ value: 'missing', label: 'Missed' },
		{ value: 'none', label: 'Not covered' }
	];

	const TREATMENT_STATUSES: TreatmentStatus[] = ['action', 'deferred'];

	function setSourceState(finding: Finding, key: string, state: string): void {
		// `none` is the absence default: clearing to it drops the record key rather
		// than storing an explicit none, keeping the authored record minimal.
		if (state === 'none') {
			delete finding.sources[key];
			return;
		}
		const existing = finding.sources[key];
		finding.sources[key] = { state: state as SourceState, text: existing?.text };
		if (finding.sources[key].text === undefined) delete finding.sources[key].text;
	}

	function setSourceText(finding: Finding, key: string, text: string): void {
		const cell = finding.sources[key];
		if (!cell) return;
		if (text === '') delete cell.text;
		else cell.text = text;
	}

	function addFinding(): void {
		block.findings.push({
			category: '',
			label: '',
			severity: '',
			sources: {},
			treatment: { before: '', after: '', status: 'action' }
		});
	}
</script>

<div class="matrix-editor">
	<div class="scale-pickers">
		<label>
			Severity scale
			<select
				value={block.severityScale}
				onchange={(event) => {
					block.severityScale = event.currentTarget.value;
					onEdit();
				}}
				aria-label="Severity scale"
			>
				<option value="">Select a scale</option>
				{#each scaleOptions as scale (scale.key)}
					<option value={scale.key}>{scale.label}</option>
				{/each}
			</select>
		</label>
		<label>
			Sources scale
			<select
				value={block.sourceScale}
				onchange={(event) => {
					block.sourceScale = event.currentTarget.value;
					onEdit();
				}}
				aria-label="Sources scale"
			>
				<option value="">Select a scale</option>
				{#each scaleOptions as scale (scale.key)}
					<option value={scale.key}>{scale.label}</option>
				{/each}
			</select>
		</label>
	</div>

	{#if scaleOptions.length === 0}
		<p class="hint">
			No document scales declared yet. Add a severity and a sources scale to the document to
			populate the selects below.
		</p>
	{/if}

	{#each block.findings as finding, findingIndex (findingIndex)}
		<fieldset class="finding">
			<legend>Finding {findingIndex + 1}</legend>
			<div class="field-row">
				<input
					value={finding.category}
					placeholder="Category"
					oninput={(event) => {
						finding.category = event.currentTarget.value;
						onEdit();
					}}
					aria-label={`Finding ${findingIndex + 1} category`}
				/>
				<input
					value={finding.label}
					placeholder="Label"
					oninput={(event) => {
						finding.label = event.currentTarget.value;
						onEdit();
					}}
					aria-label={`Finding ${findingIndex + 1} label`}
				/>
				<select
					value={finding.severity}
					onchange={(event) => {
						finding.severity = event.currentTarget.value;
						onEdit();
					}}
					aria-label={`Finding ${findingIndex + 1} severity`}
				>
					<option value="">Severity</option>
					{#each severityEntries as entry (entry.key)}
						<option value={entry.key}>{entry.label}</option>
					{/each}
				</select>
				<input
					value={finding.tag ?? ''}
					placeholder="Tag (optional)"
					oninput={(event) => {
						const value = event.currentTarget.value;
						if (value === '') delete finding.tag;
						else finding.tag = value;
						onEdit();
					}}
					aria-label={`Finding ${findingIndex + 1} tag`}
				/>
			</div>

			<p class="field-label">Sources</p>
			{#each sourceEntries as entry (entry.key)}
				<div class="field-row source-row">
					<span class="source-name">{entry.label}</span>
					<select
						value={finding.sources[entry.key]?.state ?? 'none'}
						onchange={(event) => {
							setSourceState(finding, entry.key, event.currentTarget.value);
							onEdit();
						}}
						aria-label={`Finding ${findingIndex + 1} source ${entry.label} state`}
					>
						{#each SOURCE_STATES as option (option.value)}
							<option value={option.value}>{option.label}</option>
						{/each}
					</select>
					<input
						value={finding.sources[entry.key]?.text ?? ''}
						placeholder="Note (optional)"
						disabled={finding.sources[entry.key] === undefined}
						oninput={(event) => {
							setSourceText(finding, entry.key, event.currentTarget.value);
							onEdit();
						}}
						aria-label={`Finding ${findingIndex + 1} source ${entry.label} note`}
					/>
				</div>
			{/each}

			<p class="field-label">Treatment</p>
			<div class="field-row">
				<input
					value={finding.treatment.before}
					placeholder="Before"
					oninput={(event) => {
						finding.treatment.before = event.currentTarget.value;
						onEdit();
					}}
					aria-label={`Finding ${findingIndex + 1} treatment before`}
				/>
				<input
					value={finding.treatment.after}
					placeholder="After"
					oninput={(event) => {
						finding.treatment.after = event.currentTarget.value;
						onEdit();
					}}
					aria-label={`Finding ${findingIndex + 1} treatment after`}
				/>
				<select
					value={finding.treatment.status}
					onchange={(event) => {
						finding.treatment.status = event.currentTarget.value as TreatmentStatus;
						onEdit();
					}}
					aria-label={`Finding ${findingIndex + 1} treatment status`}
				>
					{#each TREATMENT_STATUSES as status (status)}
						<option value={status}>{status}</option>
					{/each}
				</select>
			</div>

			<Button
				variant="ghost"
				onclick={() => {
					block.findings.splice(findingIndex, 1);
					onEdit();
				}}
				disabled={block.findings.length === 1}
				aria-label={`Remove finding ${findingIndex + 1}`}
			>
				Remove finding
			</Button>
		</fieldset>
	{/each}

	<Button
		onclick={() => {
			addFinding();
			onEdit();
		}}
	>
		Add finding
	</Button>
</div>

<style>
	.scale-pickers {
		display: flex;
		gap: var(--space-3);
		margin-bottom: var(--space-3);
	}

	label {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-ink-65);
	}

	.hint {
		margin: 0 0 var(--space-3);
		font-size: var(--text-sm);
		color: var(--color-ink-65);
	}

	.finding {
		margin: 0 0 var(--space-4);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-sm);
	}

	legend {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-ink-65);
	}

	.field-label {
		display: block;
		margin: var(--space-3) 0 var(--space-2);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-ink-65);
	}

	.field-row {
		display: flex;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
	}

	.source-row {
		align-items: center;
	}

	.source-name {
		flex: 0 0 8rem;
		font-size: var(--text-sm);
	}

	input,
	select {
		padding: var(--space-2) var(--space-3);
		font: inherit;
		color: inherit;
		background: var(--color-surface);
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
	}

	.field-row input {
		flex: 1;
		min-width: 0;
	}
</style>
