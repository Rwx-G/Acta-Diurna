<script lang="ts">
	import { Report, VerifyCard, toReportView } from '$lib/render';
	import type { PageProps } from './$types';

	// The public reader surface. When the load returns `verified`, the full
	// published report renders SSR-first (the same render tier as the author
	// view). Otherwise the themed VerifyCard gates access: `data.state === 'prompt'`
	// is the first paint; after the email POST, the action result (`form`) drives
	// the neutral `sent` / `invalid` / `throttled` states. The card and the report
	// both consume `--report-*` tokens, so the gateway is branded, not a generic
	// auth wall (UX Flow C).
	let { data, form }: PageProps = $props();

	const view = $derived(
		data.state === 'verified' && data.document !== null ? toReportView(data.document) : null
	);

	// The card state: a submitted action result (sent/invalid/throttled) wins over
	// the initial load state (prompt or, after a dead magic link, expired). Only
	// the unverified load states feed the card; `verified` never reaches it.
	const cardState = $derived<'prompt' | 'expired' | 'sent' | 'invalid' | 'throttled'>(
		form?.state ?? (data.state === 'verified' ? 'prompt' : data.state)
	);
	const title = $derived(view?.title ?? 'Acta Diurna');
</script>

<svelte:head>
	<title>{title}</title>
	<!-- Reader reports are private artifacts; keep them out of search indexes
	     (NFR10). The X-Robots-Tag header on /r/* covers header-only crawlers. -->
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

{#if data.state === 'verified' && view !== null && data.document !== null}
	{#key data.document}
		<Report {view} mode="slide" />
	{/key}
{:else if data.state === 'verified'}
	<div class="render-error" role="alert">
		<h1>This report cannot be displayed</h1>
		<p>Its stored format is not one this version can render.</p>
	</div>
{:else}
	<VerifyCard state={cardState} />
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
		color: var(--color-ink-65);
	}
</style>
