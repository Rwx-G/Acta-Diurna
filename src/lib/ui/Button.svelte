<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	// UX button hierarchy: primary = purple filled (one per view, the morphing
	// CTA), secondary = outline ink, danger = destructive text button.
	interface Props extends HTMLButtonAttributes {
		variant?: 'primary' | 'secondary' | 'danger';
		children: Snippet;
	}

	// `type` defaults to "button" (not the HTML "submit" default): most editor
	// buttons are structural actions inside the save form and must not submit.
	let { variant = 'secondary', type = 'button', children, ...rest }: Props = $props();
</script>

<button {type} class="btn {variant}" {...rest}>{@render children()}</button>

<style>
	.btn {
		padding: var(--space-2) var(--space-4);
		font: inherit;
		font-weight: 600;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.primary {
		color: var(--color-stone);
		background: var(--color-purple);
		border: 1px solid var(--color-purple);
	}

	.primary:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-purple) 88%, var(--color-ink));
	}

	.secondary {
		color: var(--color-ink);
		background: none;
		border: 1px solid var(--color-ink-25);
	}

	.secondary:hover:not(:disabled) {
		border-color: var(--color-purple);
		color: var(--color-purple);
	}

	.danger {
		color: var(--color-danger);
		background: none;
		border: 1px solid transparent;
	}

	.danger:hover:not(:disabled) {
		background: var(--color-danger-08);
	}
</style>
