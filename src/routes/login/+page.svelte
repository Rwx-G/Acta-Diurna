<script lang="ts">
	import Brand from '$lib/ui/Brand.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Multi mode (SMTP configured): email magic-link sign-in, the password field is
	// absent. Single mode: the password field, unchanged from today. Story 8.6
	// polishes this UX; the field split is correct here (story 8.3).
	const sent = $derived(form?.state === 'sent');
</script>

<svelte:head>
	<title>Sign in - Acta Diurna</title>
</svelte:head>

<main class="gateway">
	{#if data.multi}
		<form method="POST" action="?/request-sign-in" class="card">
			<Brand layout="stacked" markSize={52} wordmarkSize={20} />
			<h1>Sign in to your workspace</h1>

			{#if sent}
				<p class="notice" role="status">
					Check your email. If that address can sign in, a single-use link is on its way. Click it
					to open your workspace. The link expires shortly and works once.
				</p>
			{:else}
				<label for="email">Email</label>
				<input id="email" name="email" type="email" required autocomplete="email" />
				<p class="hint">We email you a single-use sign-in link. No password needed.</p>

				{#if form?.state === 'invalid'}
					<p class="error" role="alert">Enter a valid email address.</p>
				{:else if form?.state === 'throttled'}
					<p class="error" role="alert">Too many requests. Try again shortly.</p>
				{/if}

				<button type="submit">Send sign-in link</button>
			{/if}
		</form>
	{:else}
		<form method="POST" class="card">
			<Brand layout="stacked" markSize={52} wordmarkSize={20} />
			<h1>Sign in to your workspace</h1>

			<label for="password">Password</label>
			<input
				id="password"
				name="password"
				type="password"
				required
				autocomplete="current-password"
			/>

			{#if form?.message}
				<p class="error" role="alert">{form.message}</p>
			{/if}

			<button type="submit">Sign in</button>
		</form>
	{/if}
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
	}

	h1 {
		margin: 0 0 var(--space-3);
		font-size: var(--text-sm);
		font-weight: 500;
		text-align: center;
		letter-spacing: 0.01em;
		color: var(--color-ink-65);
	}

	label {
		font-weight: 600;
	}

	input {
		padding: var(--space-2) var(--space-3);
		font: inherit;
		color: inherit;
		background: var(--color-stone);
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
	}

	.error {
		margin: 0;
		color: var(--color-danger);
	}

	.notice {
		margin: 0;
		color: var(--color-ink-65);
	}

	.hint {
		margin: calc(-1 * var(--space-2)) 0 0;
		font-size: var(--text-xs);
		color: var(--color-ink-65);
	}

	button {
		margin-top: var(--space-2);
		padding: var(--space-2) var(--space-4);
		font: inherit;
		font-weight: 600;
		color: var(--color-stone);
		background: var(--color-purple);
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	button:hover {
		background: color-mix(in srgb, var(--color-purple) 88%, var(--color-ink));
	}
</style>
