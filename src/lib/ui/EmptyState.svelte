<script lang="ts">
	import type { Snippet } from 'svelte';

	// Empty states teach by action (UX): a title, an optional explanation and
	// the primary action rendered by the caller - never illustration-only.
	interface Props {
		title: string;
		description?: string;
		children?: Snippet;
	}

	let { title, description, children }: Props = $props();
</script>

<div class="empty-state">
	<p class="title">{title}</p>
	{#if description}
		<p class="description">{description}</p>
	{/if}
	{#if children}
		<div class="action">{@render children()}</div>
	{/if}
</div>

<style>
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-8) var(--space-5);
		text-align: center;
	}

	.title {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
	}

	.description {
		margin: 0;
		color: var(--color-ink-65);
	}

	.action {
		margin-top: var(--space-2);
	}
</style>
