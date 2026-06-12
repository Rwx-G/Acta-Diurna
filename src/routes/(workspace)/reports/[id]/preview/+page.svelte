<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import LivePreview from './LivePreview.svelte';

	let { data }: PageProps = $props();

	const editPath = $derived(resolve('/(workspace)/reports/[id]/edit', { id: data.reportId }));
</script>

<svelte:head>
	<title>Preview - {data.document.title} - Acta Diurna</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="preview-page">
	<div class="page-header">
		<h1>Preview</h1>
		<a class="back" href={editPath}>Back to editor</a>
	</div>
	<LivePreview document={data.document} />
</div>

<style>
	.preview-page {
		max-width: 1100px;
	}

	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-5);
	}

	h1 {
		margin: 0;
		font-size: var(--text-lg);
	}

	.back {
		font-weight: 600;
		font-size: var(--text-sm);
		color: var(--color-ink);
		text-decoration: none;
	}

	.back:hover {
		color: var(--color-purple);
	}
</style>
