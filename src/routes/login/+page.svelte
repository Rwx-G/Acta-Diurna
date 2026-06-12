<script lang="ts">
	import Brand from '$lib/ui/Brand.svelte';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
	<title>Sign in - Acta Diurna</title>
</svelte:head>

<main class="gateway">
	<form method="POST" class="card">
		<Brand layout="stacked" markSize={52} wordmarkSize={20} />
		<h1>Sign in to your workspace</h1>

		<label for="password">Password</label>
		<input id="password" name="password" type="password" required autocomplete="current-password" />

		{#if form?.message}
			<p class="error" role="alert">{form.message}</p>
		{/if}

		<button type="submit">Sign in</button>
	</form>
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
