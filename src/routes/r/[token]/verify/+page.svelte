<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { PageProps } from './$types';

	// The verify route always carries a `[token]` param (SvelteKit matched it to land
	// here), so the request-a-new-link path back to /r/[token] is always resolvable.
	const sharePath = $derived(resolve('/r/[token]', { token: page.params.token! }));

	// Prefetch-safe reader magic-link interstitial (A1). The GET landing NEVER consumes
	// the token - it renders this page. A mail-gateway link scanner that GET-prefetches
	// the emailed link only renders the interstitial; the reader's "Confirm and view
	// report" click POSTs to consume the token and open the session, so a prefetch can
	// never land the reader on the expired path. The form is a plain
	// progressively-enhanced POST (no hydration needed): it works with JavaScript
	// disabled, so the reader JS budget (NFR3) is unaffected.
	//
	// Leak-neutral (NFR9/NFR10): the page carries NO report title and NO author
	// identity - a scanner-rendered page reveals nothing. No og:/twitter: metadata, so
	// a link unfurler reads nothing. The default report theme tokens style it without
	// disclosing which report it gates.
	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Acta Diurna</title>
	<!-- Reader artifacts are private; keep this gateway out of search indexes
	     (NFR10). The X-Robots-Tag header on /r/* covers header-only crawlers. No
	     og:/twitter: metadata, so a link unfurler reads nothing about the report. -->
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="gateway">
	<div class="card" role="region" aria-label="Confirm to read this report">
		<p class="wordmark">ACTA DIURNA</p>
		{#if data.state === 'confirm'}
			<h1>Confirm to read this report</h1>
			<p class="lead">Click below to open the report. This link works once.</p>
			<form method="POST" action="?/confirm">
				<input type="hidden" name="t" value={data.token} />
				<button type="submit">Confirm and view report</button>
			</form>
		{:else}
			<h1>This link has expired</h1>
			<p class="lead">
				Magic links are single-use and valid for 15 minutes. Request a fresh one below.
			</p>
			<a class="action" href={sharePath}>Request a new link</a>
		{/if}
	</div>
</div>

<style>
	.gateway {
		display: grid;
		place-items: center;
		min-height: 100dvh;
		padding: var(--space-6);
		background: var(--report-bg, var(--color-surface));
		color: var(--report-text, var(--color-ink));
	}

	.card {
		width: 100%;
		max-width: 28rem;
		padding: var(--space-7) var(--space-6);
		background: var(--report-surface, var(--color-bg));
		border: 1px solid var(--report-rule, var(--color-ink-12));
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		text-align: center;
	}

	.wordmark {
		margin: 0 0 var(--space-5);
		font-family: var(--font-display, 'Cinzel', serif);
		font-size: var(--text-sm);
		letter-spacing: 0.18em;
		color: var(--report-accent, var(--color-purple));
	}

	h1 {
		margin: 0 0 var(--space-3);
		font-size: var(--text-xl);
		line-height: 1.2;
	}

	.lead {
		margin: 0 0 var(--space-5);
		color: var(--report-text, var(--color-ink-65));
	}

	.action,
	button {
		display: inline-block;
		margin-top: var(--space-2);
		padding: var(--space-3) var(--space-4);
		font: inherit;
		font-weight: 600;
		text-decoration: none;
		color: var(--color-bg, white);
		background: var(--report-accent, var(--color-purple));
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.action:hover,
	button:hover {
		filter: brightness(1.05);
	}
</style>
