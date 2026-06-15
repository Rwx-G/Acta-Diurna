<script lang="ts">
	import { resolve } from '$app/paths';
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
	// This route resets the workspace layout to render the reader full-bleed, so it
	// carries no chrome of its own - "View as reader" is a link, not an in-app
	// overlay, and the author would otherwise have no way back. A fixed return link
	// to the editor restores that, placed top-RIGHT to clear the reader's own
	// top-left chrome (the TOC trigger).
	const editPath = $derived(resolve('/(workspace)/reports/[id]/edit', { id: data.reportId }));
</script>

<svelte:head>
	<title>{title} - Acta Diurna</title>
	<!-- Reports are private artifacts; keep them out of search indexes (NFR10).
	     The future public reader /r/[token] (Epic 3) must carry the same tag. -->
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<a class="view-back" href={editPath}>&larr; Back to editor</a>

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
	/* Fixed return-to-editor affordance for the full-bleed reader view. Top-right to
	   clear the reader's top-left chrome (TOC trigger); above the reader z-stack
	   (the rail is 30, the detail overlay 40) so it stays reachable. Uses the
	   workspace ink/surface tokens, not the report theme tokens, so it reads as app
	   chrome over any theme rather than blending into the rendered report. */
	.view-back {
		position: fixed;
		top: var(--space-4);
		right: var(--space-4);
		z-index: 50;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-4);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-ink);
		background: var(--color-surface);
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-card);
		text-decoration: none;
	}

	.view-back:hover {
		border-color: var(--color-purple);
		color: var(--color-purple);
	}

	/* Author chrome, and the workspace is a desktop surface: on a narrow viewport the
	   reader's own top chrome (TOC trigger + reading-level switcher) owns the space,
	   so the return link would crowd and overlap it. Hide it there - a mobile viewer
	   of the reader render uses the browser back - and keep the reader controls clear. */
	@media (max-width: 768px) {
		.view-back {
			display: none;
		}
	}

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
