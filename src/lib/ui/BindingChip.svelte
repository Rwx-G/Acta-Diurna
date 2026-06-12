<script lang="ts">
	import type { BindingState } from '$lib/server/ingestion';

	// Per-block binding status chip (UX Flow B, story 2.5): green (bound/fresh),
	// amber (drifted - click to see the diagnostic and remap), red (unresolved).
	// Status is never carried by colour alone (NFR15): each state has a glyph and
	// a text label. When `onclick` is provided the chip is a button (an amber chip
	// opens its DiagnosticPanel); otherwise it is a plain status span.
	interface Props {
		state: BindingState;
		/** Drift count shown on amber/red chips, e.g. "Drifted (2)". */
		count?: number;
		onclick?: () => void;
		pressed?: boolean;
	}

	let { state, count = 0, onclick, pressed = false }: Props = $props();

	const GLYPH: Record<BindingState, string> = {
		bound: '✓', // check
		drifted: '▲', // up-triangle
		unresolved: '✕' // cross
	};

	const LABEL: Record<BindingState, string> = {
		bound: 'Bound',
		drifted: 'Drifted',
		unresolved: 'Unresolved'
	};

	const label = $derived(count > 0 ? `${LABEL[state]} (${count})` : LABEL[state]);
</script>

{#if onclick}
	<button type="button" class="chip {state}" aria-pressed={pressed} {onclick}>
		<span class="glyph" aria-hidden="true">{GLYPH[state]}</span>{label}
	</button>
{:else}
	<span class="chip {state}">
		<span class="glyph" aria-hidden="true">{GLYPH[state]}</span>{label}
	</span>
{/if}

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 2px var(--space-3);
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		border: 1px solid transparent;
		border-radius: var(--radius-pill);
	}

	button.chip {
		cursor: pointer;
	}

	.glyph {
		font-size: 10px;
	}

	.bound {
		color: var(--color-green);
		background: var(--color-green-12);
	}

	.drifted {
		color: var(--color-amber);
		background: var(--color-amber-12);
	}

	.unresolved {
		color: var(--color-danger);
		background: var(--color-danger-08);
	}

	button.chip[aria-pressed='true'] {
		border-color: currentColor;
	}
</style>
