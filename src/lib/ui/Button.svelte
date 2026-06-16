<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	// UX button hierarchy: primary = purple filled (one per view, the morphing
	// CTA), secondary = outline ink, ghost = quiet neutral text button for
	// routine structural actions (remove a block, reorder) so they do not shout,
	// danger = destructive text button reserved for real deletion/revocation.
	// icon / icon-danger = borderless square controls carrying an inline icon (the
	// per-block reorder / remove gutter, toolbar undo/redo): quiet at rest, reveal
	// intent on hover. icon hovers to the brand accent; icon-danger hovers to the
	// destructive tone (the trash / remove controls). Their ink-80 rest colour
	// keeps the small glyph above the WCAG 1.4.11 non-text-contrast floor on the
	// light card surface once revealed.
	interface Props extends HTMLButtonAttributes {
		variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon' | 'icon-danger';
		/** Bindable handle to the underlying button, for scripted focus management. */
		ref?: HTMLButtonElement;
		children: Snippet;
	}

	// `type` defaults to "button" (not the HTML "submit" default): most editor
	// buttons are structural actions inside the save form and must not submit.
	// A caller-supplied `class` is MERGED with the variant classes (not clobbered by
	// the `{...rest}` spread), so a consumer can add layout without losing the
	// button styling.
	let {
		variant = 'secondary',
		type = 'button',
		class: className,
		ref = $bindable(),
		children,
		...rest
	}: Props = $props();
</script>

<button bind:this={ref} {type} class={['btn', variant, className]} {...rest}>
	{@render children()}
</button>

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
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

	.ghost {
		color: var(--color-ink-65);
		background: none;
		border: 1px solid transparent;
	}

	.ghost:hover:not(:disabled) {
		color: var(--color-purple);
		background: var(--color-purple-08);
	}

	.danger {
		color: var(--color-danger);
		background: none;
		border: 1px solid transparent;
	}

	.danger:hover:not(:disabled) {
		background: var(--color-danger-08);
	}

	.icon,
	.icon-danger {
		color: var(--color-ink-80);
		background: none;
		border: 1px solid transparent;
	}

	.icon:hover:not(:disabled) {
		color: var(--color-purple);
		background: var(--color-purple-08);
	}

	.icon-danger:hover:not(:disabled) {
		color: var(--color-danger);
		background: var(--color-danger-08);
	}
</style>
