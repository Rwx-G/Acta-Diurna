<script lang="ts">
	import { Report, toReportView } from '$lib/render';
	import type { PageProps } from './$types';

	// The reader experience, author-side. SSR renders the full document; on the
	// client the Report shell hydrates only to wire SPA navigation. The view
	// model is built from the validated document the load returned. When the
	// stored document fails version dispatch / validation, load returns a
	// renderError instead and we show a neutral error state (FR7), not a crash.
	let { data }: PageProps = $props();

	const view = $derived(data.document === null ? null : toReportView(data.document));
	const title = $derived(data.document?.title ?? 'Cannot render report');
</script>

<svelte:head>
	<title>{title} - Acta Diurna</title>
	<!-- Reports are private artifacts; keep them out of search indexes (NFR10).
	     The future public reader /r/[token] (Epic 3) must carry the same tag. -->
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

{#if view !== null && data.document !== null}
	{#key data.document}
		<Report {view} mode="slide" />
	{/key}
{:else}
	<div class="render-error" role="alert">
		<h1>This report cannot be displayed</h1>
		<p>
			Its stored format is not one this version can render. The supported schema range is shown
			below; re-save the report in the editor to bring it up to date.
		</p>
		<ul>
			{#each data.renderError ?? [] as issue (issue.path + issue.message)}
				<li>
					<strong>{issue.message}</strong>
					{#if issue.hint}<span>{issue.hint}</span>{/if}
				</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	.render-error {
		max-width: 640px;
		margin: var(--space-8) auto;
		padding: var(--space-6);
		color: var(--report-text, var(--color-ink));
	}

	.render-error h1 {
		margin-bottom: var(--space-3);
		font-size: var(--text-xl);
	}

	.render-error p {
		margin-bottom: var(--space-4);
		color: var(--color-ink-65);
	}

	.render-error ul {
		padding: var(--space-3) var(--space-5);
		background: var(--color-surface);
		border-radius: var(--radius-sm);
	}

	.render-error span {
		display: block;
		color: var(--color-ink-65);
	}
</style>
