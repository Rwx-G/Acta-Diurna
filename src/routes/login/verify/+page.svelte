<script lang="ts">
	import { resolve } from '$app/paths';
	import Brand from '$lib/ui/Brand.svelte';
	import type { PageProps } from './$types';

	// Prefetch-safe magic-link interstitial (A1). The GET landing NEVER consumes the
	// token - it renders this page. A mail-gateway link scanner that GET-prefetches
	// the emailed link only renders the interstitial; the author's "Confirm sign-in"
	// click POSTs to consume the token and mint the session, so a prefetch can never
	// lock the author out. The form is a plain progressively-enhanced POST (no
	// hydration needed): it works with JavaScript disabled. The page carries NO author
	// identity, so a scanner-rendered page leaks nothing (neutral).
	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Confirm sign-in - Acta Diurna</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="gateway">
	<div class="card">
		<Brand layout="stacked" markSize={52} wordmarkSize={20} />
		{#if data.state === 'confirm'}
			<h1>Confirm your sign-in</h1>
			<p class="lead">Click below to open your workspace. This link works once.</p>
			<form method="POST" action="?/confirm">
				<input type="hidden" name="t" value={data.token} />
				<button type="submit">Confirm sign-in</button>
			</form>
		{:else}
			<h1>This link has expired</h1>
			<p class="lead">
				Sign-in links are single-use and valid for 15 minutes. Request a fresh one.
			</p>
			<a class="action" href={resolve('/login')}>Request a new link</a>
		{/if}
	</div>
</main>

<style>
	.gateway {
		min-height: 100vh;
		display: grid;
		place-items: center;
		padding: var(--space-5);
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		width: min(360px, 100%);
		padding: var(--space-6) var(--space-6) var(--space-7);
		background: var(--color-surface);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		text-align: center;
	}

	h1 {
		margin: 0 0 var(--space-2);
		font-size: var(--text-sm);
		font-weight: 500;
		letter-spacing: 0.01em;
		color: var(--color-ink-65);
	}

	.lead {
		margin: 0;
		color: var(--color-ink-65);
	}

	.action,
	button {
		display: inline-block;
		margin-top: var(--space-2);
		padding: var(--space-2) var(--space-4);
		font: inherit;
		font-weight: 600;
		text-align: center;
		text-decoration: none;
		color: var(--color-stone);
		background: var(--color-purple);
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.action:hover,
	button:hover {
		background: color-mix(in srgb, var(--color-purple) 88%, var(--color-ink));
	}
</style>
