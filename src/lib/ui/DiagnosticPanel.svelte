<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { BlockDiagnostic } from '$lib/server/ingestion';

	// The drift detail (UX Flow B): "expected 'severity', closest 'criticality'"
	// with a one-click remap per drifted field ("errors are guidance" - every
	// drift names its fix). The remap control itself is passed in as a snippet so
	// this component stays presentation-only and the editor owns the form action.
	// `available` lets a null-candidate drift (no close match) still offer a
	// manual pick over the fresh data set's field names.
	interface Props {
		diagnostic: BlockDiagnostic;
		available: string[];
		/** Per-drift remap control: (expectedField, suggestedField | null) -> form. */
		remap: Snippet<[string, string | null]>;
	}

	let { diagnostic, available, remap }: Props = $props();
</script>

<div
	class="panel {diagnostic.state}"
	role="group"
	aria-label="Binding diagnostic for {diagnostic.label}"
>
	<h3>{diagnostic.label}</h3>
	{#if diagnostic.state === 'unresolved'}
		<p class="lead">No bound field resolves against this data set.</p>
	{:else}
		<p class="lead">A field drifted - confirm the remap to re-resolve.</p>
	{/if}

	<ul class="drifts">
		{#each diagnostic.drifts as drift (drift.expected)}
			<li>
				<p class="line">
					Expected <code>{drift.expected}</code>
					{#if drift.closest !== null}
						- closest match <code class="closest">{drift.closest}</code>
					{:else if available.length === 0}
						- no field available to remap onto
					{:else}
						- no close match; pick a field
					{/if}
				</p>
				{@render remap(drift.expected, drift.closest)}
			</li>
		{/each}
	</ul>
</div>

<style>
	.panel {
		margin-top: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-ink-12);
		border-left-width: 3px;
		border-radius: var(--radius-sm);
		background: var(--color-surface);
	}

	.panel.drifted {
		border-left-color: var(--color-amber);
	}

	.panel.unresolved {
		border-left-color: var(--color-danger);
	}

	h3 {
		margin: 0 0 var(--space-1);
		font-size: var(--text-sm);
	}

	.lead {
		margin: 0 0 var(--space-2);
		font-size: 12px;
		color: var(--color-ink-65);
	}

	.drifts {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.line {
		margin: 0 0 var(--space-1);
		font-size: var(--text-sm);
	}

	code {
		padding: 0 var(--space-1);
		font-size: 12px;
		background: var(--color-ink-12);
		border-radius: var(--radius-sm);
	}

	code.closest {
		color: var(--color-amber);
		background: var(--color-amber-12);
	}
</style>
