<script lang="ts">
	import { formatUtcDate } from '$lib/format';
	import type { Block, DocumentV1, Section } from '$lib/schema';
	import { isBindable } from '$lib/schema';
	import type { SubmitFunction } from '@sveltejs/kit';
	import BindingChip from '$lib/ui/BindingChip.svelte';
	import DiagnosticPanel from '$lib/ui/DiagnosticPanel.svelte';
	import AudiencePicker from './AudiencePicker.svelte';
	import SectionNotesEditor from './SectionNotesEditor.svelte';
	import RemapForm from './RemapForm.svelte';
	import type { BindingGuard, DiagnosticContext, RemapActionResult } from './editor-types';

	// The right-pane inspector (UX redesign): the single, stable place that carries
	// the SELECTED element's secondary settings - audience filtering, author-only
	// speaker notes (sections), and the data-binding state + drift remap (bindable
	// blocks). These used to live inline on EVERY block and section card at once,
	// which buried the actual content under chrome. Pulling them here is pure
	// relocation: the SAME AudiencePicker / SectionNotesEditor / BindingChip /
	// DiagnosticPanel / RemapForm components, bound through to the SAME working-copy
	// `doc` arrays the left stack renders, so an edit here mutates the one document
	// and rides the same validated-save seam (`onEdit`).
	interface Props {
		/** The live working copy: the inspector resolves + mutates the selected element on it. */
		doc: DocumentV1;
		/** The selected target (a block or a section by id), or null at rest. */
		selected: { kind: 'block' | 'section'; id: string } | null;
		/** Per-block binding diagnostics + the rebind source's fields / id (Epic 10.5). */
		diagnostics: DiagnosticContext;
		/** The editor's dirty/saving guard (Epic 10.5), for the inline remap. */
		bindingGuard: BindingGuard;
		/** Reports a successful inline remap UP so the editor reconciles the token (Epic 10.5). */
		onRemapped: (savedAt: string, document: DocumentV1, blockId: string) => void;
		onEdit: () => void;
	}

	let {
		doc = $bindable(),
		selected,
		diagnostics,
		bindingGuard,
		onRemapped,
		onEdit
	}: Props = $props();

	// Resolve the selected element on the LIVE doc by id (not by index): a structural
	// reorder/delete changes indices but not ids, so an id lookup keeps the inspector
	// pointed at the same element across the keyed `{#each}` rebuilds. The lookups
	// return the live `$state` proxy node, so the bound editors below mutate the real
	// document in place.
	const selectedSection = $derived<Section | null>(
		selected?.kind === 'section'
			? (doc.sections.find((section) => section.id === selected.id) ?? null)
			: null
	);

	function findBlock(id: string): { section: Section; block: Block } | null {
		for (const section of doc.sections) {
			const block = section.blocks.find((candidate) => candidate.id === id);
			if (block) return { section, block };
		}
		return null;
	}

	const selectedBlockHit = $derived(selected?.kind === 'block' ? findBlock(selected.id) : null);
	const selectedBlock = $derived<Block | null>(selectedBlockHit?.block ?? null);

	// A short, human label for the inspector heading so the author knows what they are
	// editing without scrolling back to the card.
	const targetLabel = $derived(
		selectedSection
			? `Section: ${selectedSection.title || 'Untitled'}`
			: selectedBlock
				? `${selectedBlock.type} block`
				: null
	);

	// Bound-vs-static state (Epic 10.5), now read off the inspector's selected block.
	const blockIsBindable = $derived(selectedBlock ? isBindable(selectedBlock) : false);
	const boundDataSetId = $derived(
		selectedBlock && isBindable(selectedBlock) && selectedBlock.binding
			? (selectedBlock.binding.dataSetId ?? null)
			: null
	);
	const dataAsOf = $derived(
		selectedBlock && isBindable(selectedBlock) && selectedBlock.binding
			? (selectedBlock.binding.dataAsOf ?? null)
			: null
	);

	const blockDiagnostic = $derived(
		selectedBlock ? (diagnostics.byBlock.get(selectedBlock.id) ?? undefined) : undefined
	);
	const diagnosticFields = $derived(diagnostics.fields);
	const diagnosticDataSetId = $derived(diagnostics.dataSetId);

	let remapOpen = $state(false);

	// Collapse the remap when the surfaced diagnostic changes (a rebind replaces it) or
	// when the selection moves to a different block, so a stale expand state never
	// shows against a new drift / a different block.
	$effect(() => {
		void blockDiagnostic;
		void selected;
		remapOpen = false;
	});

	// The inline remap (Epic 10.5): the SAME `?/remap` action and submit behavior the
	// block card used to host, now driven from the inspector for the selected block. The
	// dirty/saving guard and the onRemapped reconcile are preserved exactly.
	const submitRemap: SubmitFunction = ({ cancel }) => {
		if (!bindingGuard(cancel)) return;
		return async ({ result }) => {
			if (result.type === 'success') {
				remapOpen = false;
				const payload = result.data as Partial<RemapActionResult> | undefined;
				if (payload?.remappedAt && payload.document && selectedBlock) {
					onRemapped(payload.remappedAt, payload.document, selectedBlock.id);
				}
			}
		};
	};
</script>

<aside class="inspector" aria-label="Inspector">
	<h2 class="inspector-title">Inspector</h2>
	{#if targetLabel}
		<p class="inspector-for">{targetLabel}</p>
	{/if}

	{#if selectedSection}
		<div class="insp-group">
			<AudiencePicker
				bind:audiences={selectedSection.audiences}
				legend="Section audiences"
				{onEdit}
			/>
		</div>
		<div class="insp-group">
			<!-- Author-private speaker notes (Story 6.2 / 10.6): edited on the working copy
			     and stripped server-side before any reader is served. -->
			<SectionNotesEditor bind:notes={selectedSection.notes} {onEdit} />
		</div>
	{:else if selectedBlock}
		<div class="insp-group">
			<AudiencePicker bind:audiences={selectedBlock.audiences} legend="Block audiences" {onEdit} />
		</div>

		{#if blockIsBindable}
			<div class="insp-group">
				<div class="binding-state" aria-label="Binding state">
					{#if boundDataSetId}
						<span class="state-badge bound">Bound to data set</span>
						{#if dataAsOf}<span class="data-as-of">Data as of {formatUtcDate(dataAsOf)}</span>{/if}
					{:else}
						<span class="state-badge static">Static data</span>
					{/if}
					{#if blockDiagnostic}
						<BindingChip
							state={blockDiagnostic.state}
							count={blockDiagnostic.drifts.length}
							pressed={remapOpen}
							onclick={() => (remapOpen = !remapOpen)}
						/>
					{/if}
				</div>
				{#if blockDiagnostic && remapOpen && selectedBlock}
					<DiagnosticPanel diagnostic={blockDiagnostic} available={diagnosticFields}>
						{#snippet remap(expectedField: string, suggested: string | null)}
							<RemapForm
								blockId={selectedBlock.id}
								dataSetId={diagnosticDataSetId ?? ''}
								{expectedField}
								{suggested}
								fields={diagnosticFields}
								submit={submitRemap}
							/>
						{/snippet}
					</DiagnosticPanel>
				{/if}
			</div>
		{/if}
	{:else}
		<p class="inspector-empty">Select a block or section to edit its settings.</p>
	{/if}
</aside>

<style>
	.inspector {
		padding: var(--space-4) var(--space-5);
		background: var(--color-surface);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-md);
	}

	.inspector-title {
		margin: 0 0 var(--space-1);
		font-size: var(--text-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-ink-65);
	}

	.inspector-for {
		margin: 0 0 var(--space-3);
		padding-bottom: var(--space-3);
		font-size: var(--text-sm);
		color: var(--color-ink-65);
		border-bottom: 1px solid var(--color-ink-12);
	}

	.inspector-empty {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-ink-65);
	}

	.insp-group {
		margin-bottom: var(--space-3);
	}

	.insp-group:last-child {
		margin-bottom: 0;
	}

	/* Binding state row (Epic 10.5): the bound-vs-static badge and any drift chip. */
	.binding-state {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}

	/* The shared BindingChip composites a translucent state background over the element
	   behind it. Inside the inspector that element is `--color-surface`; give the chips
	   an OPAQUE state surface so the contrast is deterministic and AA-clean regardless of
	   the pane background (matching the discipline the block card used). */
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
		background: var(--color-stone);
	}

	.data-as-of {
		font-size: 12px;
		color: var(--color-ink-65);
	}
</style>
