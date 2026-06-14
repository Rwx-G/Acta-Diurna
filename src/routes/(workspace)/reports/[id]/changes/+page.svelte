<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import PageHeader from '$lib/ui/PageHeader.svelte';
	import SeriesDiffView from './SeriesDiffView.svelte';
	import type { PageProps } from './$types';

	// The workspace "what changed since last issue" view (Story 9.3): the author
	// payoff of the series diff engine. Owner-scoped behind the workspace guard, it
	// renders the SeriesDiff the loader resolved - either the per-section changelog
	// or a neutral state. Desktop workspace surface (the mobile e2e project skips
	// workspace specs).
	let { data }: PageProps = $props();

	const editPath = $derived(resolve('/(workspace)/reports/[id]/edit', { id: page.params.id! }));
</script>

<svelte:head>
	<title>{data.title} - What changed</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="changes-page">
	<PageHeader
		title="What changed since the last issue"
		lede="A block-by-block changelog of this published issue against its predecessor. It shows ids, titles, types, and change flags only - never your speaker notes or the previous issue's content."
	>
		{#snippet action()}
			<a class="back" href={editPath}>Back to editor</a>
		{/snippet}
	</PageHeader>

	{#if data.state === 'not-published'}
		<div class="gate" role="status">
			<h2>Publish to compare</h2>
			<p>
				The "what changed" view diffs two published editions. Publish
				<strong>{data.title}</strong> first, then open this view to see how it differs from the previous
				issue.
			</p>
		</div>
	{:else}
		<SeriesDiffView diff={data.diff} baseline={data.baseline} />
	{/if}
</div>

<style>
	.changes-page {
		padding: var(--space-6) var(--space-5);
	}

	.back {
		font-weight: 600;
		color: var(--color-purple);
		text-decoration: none;
	}

	.back:hover {
		text-decoration: underline;
	}

	.gate {
		max-width: var(--content-width);
		margin: 0 auto;
		padding: var(--space-6);
	}

	.gate h2 {
		margin: 0 0 var(--space-3);
		font-size: var(--text-xl);
	}

	.gate p {
		color: var(--color-ink-65);
	}
</style>
