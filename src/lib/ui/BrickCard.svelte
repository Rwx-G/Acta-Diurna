<script lang="ts">
	import type { Brick } from '$lib/bricks';

	// Library entry in the composer's left zone (UX Component Strategy: BrickCard).
	// Click to append the brick to the structure. A button, not a div, so it is
	// keyboard-operable and focus-visible for free.
	interface Props {
		brick: Brick;
		onAdd: () => void;
	}

	let { brick, onAdd }: Props = $props();
</script>

<button type="button" class="brick-card" onclick={onAdd} aria-label={`Add ${brick.label}`}>
	<span class="label">{brick.label}</span>
	<span class="description">{brick.description}</span>
</button>

<style>
	.brick-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		width: 100%;
		padding: var(--space-3) var(--space-4);
		text-align: left;
		font: inherit;
		color: var(--color-ink);
		background: var(--color-surface);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-md);
		cursor: pointer;
	}

	.brick-card:hover {
		border-color: var(--color-purple);
	}

	.label {
		font-weight: 600;
		font-size: var(--text-sm);
	}

	.description {
		font-size: var(--text-sm);
		color: var(--color-ink-65);
	}
</style>
