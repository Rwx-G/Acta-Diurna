<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';

	let { children }: { children: Snippet } = $props();
</script>

<div class="workspace">
	<nav class="rail" aria-label="Workspace">
		<p class="wordmark">Acta Diurna</p>
		<a href={resolve('/(workspace)/reports')}>Reports</a>
		<a href={resolve('/(workspace)/skeletons')}>Skeletons</a>
		<a href={resolve('/(workspace)/data-sets')}>Data sets</a>
		<a href={resolve('/(workspace)/settings')}>Settings</a>
		<!-- Relative ?/logout: every workspace page exposes the shared logout action. -->
		<form method="POST" action="?/logout" class="signout">
			<button type="submit">Sign out</button>
		</form>
	</nav>
	<main>{@render children()}</main>
</div>

<style>
	.workspace {
		display: grid;
		grid-template-columns: 200px 1fr;
		min-height: 100vh;
	}

	.rail {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-5) var(--space-4);
		background: var(--color-surface);
		border-right: 1px solid var(--color-ink-12);
	}

	.wordmark {
		margin: 0 0 var(--space-5);
		font-family: var(--font-wordmark);
		font-size: 15px;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--color-purple);
	}

	.rail a {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		color: var(--color-ink);
		text-decoration: none;
		background: var(--color-purple-08);
		font-weight: 600;
	}

	.rail a:hover {
		color: var(--color-purple);
	}

	.signout {
		margin-top: auto;
	}

	.signout button {
		width: 100%;
		padding: var(--space-1) var(--space-3);
		font: inherit;
		color: var(--color-ink);
		background: none;
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.signout button:hover {
		border-color: var(--color-purple);
		color: var(--color-purple);
	}

	main {
		min-width: 0;
		padding: var(--space-6) var(--space-6) var(--space-8);
	}
</style>
