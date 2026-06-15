<script lang="ts">
	import { formatUtcDate } from '$lib/format';
	import type { Block, DocumentV1, Scales } from '$lib/schema';
	import { isBindable } from '$lib/schema';
	import type { BlockDiagnostic } from '$lib/server/ingestion';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Button from '$lib/ui/Button.svelte';
	import BindingChip from '$lib/ui/BindingChip.svelte';
	import DiagnosticPanel from '$lib/ui/DiagnosticPanel.svelte';
	import type { BindingGuard, DiagnosticContext, RemapActionResult } from './editor-types';
	import RemapForm from './RemapForm.svelte';
	import AudiencePicker from './AudiencePicker.svelte';
	import CalloutBlockEditor from './CalloutBlockEditor.svelte';
	import CardGridBlockEditor from './CardGridBlockEditor.svelte';
	import ChartBlockEditor from './ChartBlockEditor.svelte';
	import ChipClusterBlockEditor from './ChipClusterBlockEditor.svelte';
	import CodeBlockEditor from './CodeBlockEditor.svelte';
	import ComparisonMatrixBlockEditor from './ComparisonMatrixBlockEditor.svelte';
	import FieldGridBlockEditor from './FieldGridBlockEditor.svelte';
	import ImageBlockEditor from './ImageBlockEditor.svelte';
	import IssueList from './IssueList.svelte';
	import KpiBlockEditor from './KpiBlockEditor.svelte';
	import LegendBlockEditor from './LegendBlockEditor.svelte';
	import ListBlockEditor from './ListBlockEditor.svelte';
	import SetMembershipBlockEditor from './SetMembershipBlockEditor.svelte';
	import TableBlockEditor from './TableBlockEditor.svelte';
	import TextBlockEditor from './TextBlockEditor.svelte';
	import TimelineBlockEditor from './TimelineBlockEditor.svelte';
	import type { EditorIssue, MatrixBlockOption } from './editor-state';

	// Thin dispatcher: owns the shared block chrome (header controls, inline
	// issue list, audience picker) and delegates the type-specific body to one
	// of the five per-type editors. The `{@const}` narrows the block union so
	// each child binds a precisely typed block (Svelte 5 ownership: a child that
	// mutates a prop needs that prop bound, not the whole block re-derived).
	interface Props {
		block: Block;
		blockIndex: number;
		count: number;
		issues: EditorIssue[];
		/** Document scales, for the scale-referencing block editors (comparison-matrix, legend). */
		scales?: Scales;
		/** Comparison-matrix blocks in the document, for the set-membership block editor. */
		matrixBlocks?: MatrixBlockOption[];
		/** This block's binding diagnostic from the last rebind (Epic 10.5), if drifted/unresolved. */
		diagnostic?: BlockDiagnostic;
		/** The rebind source's available fields + data set id (Epic 10.5), for the inline remap. */
		diagnosticContext?: DiagnosticContext;
		/** The editor's dirty/saving guard (Epic 10.5): a remap reseed must not run with unsaved edits. */
		bindingGuard?: BindingGuard;
		/** Reports a successful inline remap UP so the editor reconciles the token (Epic 10.5). */
		onRemapped?: (savedAt: string, document: DocumentV1, blockId: string) => void;
		onEdit: () => void;
		onRemove: () => void;
		onMove: (direction: -1 | 1) => void;
	}

	let {
		block = $bindable(),
		blockIndex,
		count,
		issues,
		scales,
		matrixBlocks,
		diagnostic,
		diagnosticContext,
		bindingGuard,
		onRemapped,
		onEdit,
		onRemove,
		onMove
	}: Props = $props();

	const diagnosticFields = $derived(diagnosticContext?.fields ?? []);
	const diagnosticDataSetId = $derived(diagnosticContext?.dataSetId ?? null);

	// Bound-vs-static state (Epic 10.5): a bindable block whose `binding` carries a
	// resolved `dataSetId` is BOUND (its values come from the data set); otherwise it
	// carries static data (edited in 10.3/10.4) or only declares expected fields. The
	// editor shows this state clearly so the author knows where the values come from.
	// `isBindable(block)` is the schema's type guard: it narrows the block union so
	// `block.binding` is reachable, which a boolean `blockIsBindable` would not do.
	const blockIsBindable = $derived(isBindable(block));
	const boundDataSetId = $derived(
		isBindable(block) && block.binding ? (block.binding.dataSetId ?? null) : null
	);
	const dataAsOf = $derived(
		isBindable(block) && block.binding ? (block.binding.dataAsOf ?? null) : null
	);

	let remapOpen = $state(false);

	// Reset the inline remap panel when the block's diagnostic changes (Epic 10.5): a
	// rebind replaces the per-block diagnostic, so a panel left open from the prior
	// diagnostic would show a stale expand state against the new drift. Collapse it so
	// the new diagnostic surfaces fresh (the author re-opens to act on the new drift).
	$effect(() => {
		void diagnostic;
		remapOpen = false;
	});

	// The inline remap (Epic 10.5): reuses the EXISTING `?/remap` action and the
	// shared DiagnosticPanel, surfaced AT the drifted block. On success the editor
	// reconciles the concurrency token (onRemapped) - the binding mutated the report.
	const submitRemap: SubmitFunction = ({ cancel }) => {
		// Block the remap while the editor has unsaved edits in flight (the DATA-LOSS
		// guard): a remap reseed would overwrite them. Let the autosave land, then retry.
		if (bindingGuard && !bindingGuard(cancel)) return;
		return async ({ result }) => {
			if (result.type === 'success') {
				remapOpen = false;
				const payload = result.data as Partial<RemapActionResult> | undefined;
				if (payload?.remappedAt && payload.document && onRemapped) {
					onRemapped(payload.remappedAt, payload.document, block.id);
				}
			}
		};
	};
</script>

<!-- `tabindex="-1"` + `data-block-id` make this card a scriptable focus target so
     the section's structural-edit focus management (add / move / delete) can move
     focus to the right block without putting the card in the tab order (Story 10.2,
     NFR15). -->
<article
	class="block-card"
	aria-label={`${block.type} block`}
	tabindex="-1"
	data-block-id={block.id}
>
	<header>
		<span class="block-type">{block.type}</span>
		<div class="controls">
			<Button onclick={() => onMove(-1)} disabled={blockIndex === 0}>
				<span class="sr-only">Move block up</span>
				<span aria-hidden="true">Up</span>
			</Button>
			<Button onclick={() => onMove(1)} disabled={blockIndex === count - 1}>
				<span class="sr-only">Move block down</span>
				<span aria-hidden="true">Down</span>
			</Button>
			<Button variant="ghost" onclick={onRemove}>
				<span class="sr-only">Remove block</span>
				<span aria-hidden="true">Remove</span>
			</Button>
		</div>
	</header>

	<IssueList {issues} variant="block" showField />

	<AudiencePicker bind:audiences={block.audiences} legend="Block audiences" {onEdit} />

	<!-- Binding state at the block (Epic 10.5): a bindable block shows whether its
	     values come from a data set (BOUND) or are static, plus any drift diagnostic
	     from the last rebind, with the inline remap reaching the EXISTING `?/remap`
	     action - the diagnostics surface where the author is editing, not on a
	     separate screen. The renderer-purity boundary holds: this is a workspace-only
	     editor surface, the type-only `BlockDiagnostic` import erases at build. -->
	{#if blockIsBindable}
		<div class="binding-state" aria-label="Binding state">
			{#if boundDataSetId}
				<span class="state-badge bound">Bound to data set</span>
				{#if dataAsOf}<span class="data-as-of">Data as of {formatUtcDate(dataAsOf)}</span>{/if}
			{:else}
				<span class="state-badge static">Static data</span>
			{/if}
			{#if diagnostic}
				<BindingChip
					state={diagnostic.state}
					count={diagnostic.drifts.length}
					pressed={remapOpen}
					onclick={() => (remapOpen = !remapOpen)}
				/>
			{/if}
		</div>
		{#if diagnostic && remapOpen}
			<DiagnosticPanel {diagnostic} available={diagnosticFields}>
				{#snippet remap(expectedField: string, suggested: string | null)}
					<RemapForm
						blockId={block.id}
						dataSetId={diagnosticDataSetId ?? ''}
						{expectedField}
						{suggested}
						fields={diagnosticFields}
						submit={submitRemap}
					/>
				{/snippet}
			</DiagnosticPanel>
		{/if}
	{/if}

	{#if block.type === 'text'}
		<TextBlockEditor bind:block {onEdit} />
	{:else if block.type === 'table'}
		<TableBlockEditor bind:block {scales} {onEdit} />
	{:else if block.type === 'chart'}
		<ChartBlockEditor bind:block {onEdit} />
	{:else if block.type === 'kpi'}
		<KpiBlockEditor bind:block {onEdit} />
	{:else if block.type === 'image'}
		<ImageBlockEditor bind:block {onEdit} />
	{:else if block.type === 'comparison-matrix'}
		<ComparisonMatrixBlockEditor bind:block {scales} {onEdit} />
	{:else if block.type === 'field-grid'}
		<FieldGridBlockEditor bind:block {onEdit} />
	{:else if block.type === 'legend'}
		<LegendBlockEditor bind:block {scales} {onEdit} />
	{:else if block.type === 'set-membership'}
		<SetMembershipBlockEditor bind:block {matrixBlocks} {onEdit} />
	{:else if block.type === 'chip-cluster'}
		<ChipClusterBlockEditor bind:block {scales} {onEdit} />
	{:else if block.type === 'callout'}
		<CalloutBlockEditor bind:block {onEdit} />
	{:else if block.type === 'code'}
		<CodeBlockEditor bind:block {onEdit} />
	{:else if block.type === 'card-grid'}
		<CardGridBlockEditor bind:block {onEdit} />
	{:else if block.type === 'list'}
		<ListBlockEditor bind:block {onEdit} />
	{:else if block.type === 'timeline'}
		<TimelineBlockEditor bind:block {scales} {onEdit} />
	{/if}
</article>

<style>
	.block-card {
		margin-bottom: var(--space-4);
		padding: var(--space-4) var(--space-5);
		background: var(--color-stone);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-sm);
	}

	/* The card is a scripted focus target (structural-edit focus management); show a
	   clear focus ring when focus lands on it so a keyboard user sees where they are. */
	.block-card:focus-visible {
		outline: 2px solid var(--color-purple);
		outline-offset: 2px;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-3);
	}

	.block-type {
		font-size: var(--text-sm);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-ink-65);
	}

	.controls {
		display: flex;
		gap: var(--space-1);
	}

	/* Binding state row (Epic 10.5): the bound-vs-static badge and any drift chip,
	   shown above the block's editing fields so the author sees where the values come
	   from before they edit. */
	.binding-state {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
	}

	/* The shared BindingChip composites its translucent state background over the
	   element behind it. Inside the block card that element is `--color-stone`, where
	   the amber chip's 12%-over-stone background drops the amber text to a 4.46:1
	   contrast (just under the WCAG AA 4.5:1 floor). Give the chips inside this row an
	   OPAQUE state surface (amber/green/danger mixed with white, not transparent) so the
	   contrast is deterministic and AA-clean regardless of the card background. Scoped
	   to `.binding-state` so the refill panel's own chips are untouched. */
	.binding-state :global(.chip.drifted) {
		background: color-mix(in srgb, var(--color-amber) 14%, white);
	}

	.binding-state :global(.chip.bound) {
		background: color-mix(in srgb, var(--color-green) 14%, white);
	}

	.binding-state :global(.chip.unresolved) {
		background: color-mix(in srgb, var(--color-danger) 12%, white);
	}

	.state-badge {
		padding: 2px var(--space-3);
		font-size: 12px;
		font-weight: 600;
		border-radius: var(--radius-pill);
	}

	.state-badge.bound {
		color: var(--color-green);
		background: var(--color-green-12);
	}

	.state-badge.static {
		color: var(--color-ink-65);
		background: var(--color-surface);
	}

	.data-as-of {
		font-size: 12px;
		color: var(--color-ink-65);
	}

	/* `.sr-only` is the shared workspace base (sr-only.css), scoped under
	   `.block-card` - the wrapper this component renders. */
</style>
