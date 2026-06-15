<script lang="ts">
	import { AUDIENCES, type Block } from '$lib/schema';
	import type { Scales } from '$lib/schema';
	import { isBindable } from '$lib/schema';
	import type { BlockDiagnostic } from '$lib/server/ingestion';
	import Button from '$lib/ui/Button.svelte';
	import type { EditorSelection } from './editor-types';
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
	import type { BlockType } from '$lib/schema';
	import type { EditorIssue, MatrixBlockOption } from './editor-state';

	// Thin dispatcher: owns the calm block chrome (a quiet type chip, a compact
	// at-a-glance state row, the hover-revealed move/remove gutter, the inline issue
	// list) and delegates the type-specific body to one of the per-type editors. The
	// per-element SETTINGS (audience, binding state + remap) no longer live here; they
	// surface in the right-pane inspector for the SELECTED block (UX redesign). The
	// `diagnostic` prop is still threaded in - read-only here, for the compact "Derive"
	// tag so the author sees drift status without selecting.
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
		/** Whether this block is the selected element (drives the selection ring). */
		selected: boolean;
		/** Reports a new selection UP so the inspector follows (UX redesign). */
		onSelect: (target: EditorSelection) => void;
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
		selected,
		onSelect,
		onEdit,
		onRemove,
		onMove
	}: Props = $props();

	// A human type chip label (UX redesign): a calm capitalized name rather than the
	// raw schema key. Falls back to the key for a forward-version type the validator let
	// through.
	const TYPE_LABEL = {
		text: 'Texte',
		table: 'Table',
		chart: 'Graphique',
		kpi: 'KPI',
		image: 'Image',
		'comparison-matrix': 'Matrice',
		'field-grid': 'Field grid',
		legend: 'Legende',
		'set-membership': 'Set membership',
		'chip-cluster': 'Chips',
		callout: 'Callout',
		code: 'Code',
		'card-grid': 'Card grid',
		list: 'Liste',
		timeline: 'Timeline'
	} satisfies Record<BlockType, string>;
	const typeLabel = $derived((TYPE_LABEL as Record<string, string>)[block.type] ?? block.type);

	// Compact at-a-glance state, non-interactive (the controls live in the inspector):
	// the audience tag only when the block is restricted to a subset of levels, a
	// "Lie"/"Statique" tag for bindable blocks, and a "Derive" tag when a drift
	// diagnostic exists - so the author reads status without selecting.
	const blockIsBindable = $derived(isBindable(block));
	const isBound = $derived(isBindable(block) && block.binding ? !!block.binding.dataSetId : false);
	const audienceLabel = $derived(
		block.audiences && block.audiences.length > 0 && block.audiences.length < AUDIENCES.length
			? block.audiences.join(', ')
			: null
	);

	function selectBlock(): void {
		onSelect({ kind: 'block', id: block.id });
	}

	// Exhaustiveness guard for the `{#if block.type === ...}` dispatch below, matching
	// the renderer's BlockRenderer backstop. The template chain cannot itself be
	// exhaustiveness-checked, so this `satisfies Record<BlockType, true>` is the
	// compile-time backstop: a new block type missing a per-type editor arm is a
	// compile error here. The terminal `{:else}` only catches a forward-version block
	// the validator let through, never a forgotten v1 type. Keep this set in lockstep
	// with the dispatch arms.
	const HANDLED_BLOCK_TYPES = {
		text: true,
		table: true,
		chart: true,
		kpi: true,
		image: true,
		'comparison-matrix': true,
		'field-grid': true,
		legend: true,
		'chip-cluster': true,
		callout: true,
		code: true,
		'set-membership': true,
		'card-grid': true,
		list: true,
		timeline: true
	} satisfies Record<BlockType, true>;
	void HANDLED_BLOCK_TYPES;
</script>

<!-- `tabindex="-1"` + `data-block-id` make this card a scriptable focus target so
     the section's structural-edit focus management (add / move / delete) can move
     focus to the right block without putting the card in the tab order (Story 10.2,
     NFR15). Clicking anywhere in the card or focusing into it selects the block, so the
     inspector shows its settings (UX redesign). -->
<article
	class="block-card"
	class:selected
	aria-label={`${block.type} block`}
	tabindex="-1"
	data-block-id={block.id}
	onclickcapture={selectBlock}
	onfocusin={selectBlock}
>
	<header>
		<div class="block-head">
			<span class="type-chip">{typeLabel}</span>
			<div class="state-tags" aria-hidden="true">
				{#if blockIsBindable}
					<span class="mini-tag" class:bound={isBound}>{isBound ? 'Lie' : 'Statique'}</span>
				{/if}
				{#if diagnostic}<span class="mini-tag drift">Derive</span>{/if}
				{#if audienceLabel}<span class="mini-tag">{audienceLabel}</span>{/if}
			</div>
		</div>
		<div class="gutter">
			<span class="gutter-hint" aria-hidden="true">&#8943;</span>
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
		</div>
	</header>

	<IssueList {issues} variant="block" showField />

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
	{:else}
		<!-- A validated-but-unhandled block (a forward-version type the validator let
		     through). Show a neutral placeholder rather than blanking the card, so an
		     unknown/future type degrades gracefully. The HANDLED_BLOCK_TYPES guard above
		     makes a forgotten v1 type a compile error, so this only fires for a future
		     schema version. -->
		<p class="unsupported" role="status">
			This block type is not editable in this version of the workspace.
		</p>
	{/if}
</article>

<style>
	.block-card {
		margin-bottom: var(--space-4);
		padding: var(--space-4) var(--space-5);
		background: var(--color-stone);
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
	}

	/* The card is a scripted focus target (structural-edit focus management); show a
	   clear focus ring when focus lands on it so a keyboard user sees where they are. */
	.block-card:focus-visible {
		outline: 2px solid var(--color-purple);
		outline-offset: 2px;
	}

	/* The selected block carries the same purple ring as :focus-visible, so the
	   selection state reads in the same visual language as keyboard focus. */
	.block-card.selected {
		background: var(--color-surface);
		border-color: var(--color-purple);
		box-shadow: 0 0 0 1px var(--color-purple);
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		margin-bottom: var(--space-3);
	}

	.block-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		min-width: 0;
	}

	.type-chip {
		display: inline-flex;
		align-items: center;
		font-size: var(--text-xs);
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-ink-65);
		background: var(--color-ink-08);
		padding: 2px var(--space-3);
		border-radius: var(--radius-pill);
	}

	.state-tags {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		flex-wrap: wrap;
	}

	.mini-tag {
		font-size: var(--text-xs);
		font-weight: 600;
		padding: 1px var(--space-2);
		color: var(--color-ink-65);
		background: var(--color-ink-08);
		border-radius: var(--radius-pill);
		text-transform: capitalize;
	}

	.mini-tag.bound {
		color: var(--color-green);
		background: color-mix(in srgb, var(--color-green) 14%, white);
	}

	.mini-tag.drift {
		color: var(--color-amber);
		background: color-mix(in srgb, var(--color-amber) 14%, white);
	}

	/* Hover/focus-revealed gutter (UX redesign, WCAG 2.2 SC 3.2.7). At rest the
	   control cluster is opacity:0 but the gutter keeps a PERSISTENT faint glyph so the
	   author knows controls exist; hover, focus-within, and selection reveal the
	   buttons. The buttons stay in the DOM and the tab order (a keyboard focus reveals
	   them via :focus-within), so no control is hover-only. */
	.gutter {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	.gutter-hint {
		color: var(--color-ink-25);
		font-size: var(--text-sm);
	}

	.controls {
		display: flex;
		gap: var(--space-1);
		opacity: 0;
		transition: opacity 0.12s ease;
	}

	.block-card:hover .controls,
	.block-card:focus-within .controls,
	.block-card.selected .controls {
		opacity: 1;
	}

	/* The ghost Remove button's default text (`--color-ink-65`) drops below the WCAG AA
	   4.5:1 floor on the light card surface; pin the gutter ghost text to a darker ink so
	   the revealed control is AA-clean. Scoped to the gutter so the global ghost variant
	   is untouched. */
	.controls :global(.btn.ghost) {
		color: var(--color-ink-80);
	}

	/* The exhaustiveness fallback (forward-version block type): a neutral notice so an
	   unknown block degrades gracefully instead of blanking the card. */
	.unsupported {
		margin: 0;
		padding: var(--space-3) var(--space-4);
		font-size: var(--text-sm);
		color: var(--color-amber);
		background: var(--color-amber-12);
		border-radius: var(--radius-sm);
	}

	/* `.sr-only` is the shared workspace base (sr-only.css), scoped under
	   `.block-card` - the wrapper this component renders. */
</style>
