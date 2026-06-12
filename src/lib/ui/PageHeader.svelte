<script lang="ts">
	import type { Snippet } from 'svelte';

	// One header treatment for every workspace content page (Reports, Skeletons,
	// Data sets, Settings): a title, an optional one-line lede, and an optional
	// right-aligned action. Bounded to the shared content column so every page
	// sits in the same centered measure instead of each reinventing its width
	// and heading size.
	interface Props {
		title: string;
		lede?: string;
		action?: Snippet;
	}

	let { title, lede, action }: Props = $props();
</script>

<header class="page-header">
	<div class="titles">
		<h1>{title}</h1>
		{#if lede}
			<p class="lede">{lede}</p>
		{/if}
	</div>
	{#if action}
		<div class="action">{@render action()}</div>
	{/if}
</header>

<style>
	.page-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-5);
		max-width: var(--content-width);
		margin: 0 auto var(--space-6);
	}

	.titles {
		min-width: 0;
	}

	h1 {
		margin: 0;
		font-size: var(--text-2xl);
		font-weight: 600;
		line-height: var(--leading-tight);
	}

	.lede {
		margin: var(--space-2) 0 0;
		max-width: 70ch;
		color: var(--color-ink-65);
	}

	.action {
		flex-shrink: 0;
	}
</style>
