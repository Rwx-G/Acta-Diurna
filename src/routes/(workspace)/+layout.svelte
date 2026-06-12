<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Brand from '$lib/ui/Brand.svelte';

	let { children }: { children: Snippet } = $props();

	// A nav item is current when the path is it or nested under it, so the editor
	// (/reports/:id/edit) keeps "Reports" lit and the composer keeps "Skeletons".
	function active(base: string): boolean {
		const path = page.url.pathname;
		return path === base || path.startsWith(`${base}/`);
	}
</script>

<div class="workspace">
	<nav class="rail" aria-label="Workspace">
		<a class="brand-link" href={resolve('/(workspace)/reports')} aria-label="Acta Diurna home">
			<Brand layout="horizontal" markSize={26} />
		</a>

		<a
			href={resolve('/(workspace)/reports')}
			class:active={active('/reports')}
			aria-current={active('/reports') ? 'page' : undefined}>Reports</a
		>
		<a
			href={resolve('/(workspace)/skeletons')}
			class:active={active('/skeletons')}
			aria-current={active('/skeletons') ? 'page' : undefined}>Skeletons</a
		>
		<a
			href={resolve('/(workspace)/data-sets')}
			class:active={active('/data-sets')}
			aria-current={active('/data-sets') ? 'page' : undefined}>Data sets</a
		>
		<a
			href={resolve('/(workspace)/settings')}
			class:active={active('/settings')}
			aria-current={active('/settings') ? 'page' : undefined}>Settings</a
		>

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
		grid-template-columns: 216px 1fr;
		min-height: 100vh;
	}

	.rail {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-5) var(--space-4);
		background: var(--color-surface);
		border-right: 1px solid var(--color-ink-12);
	}

	.brand-link {
		display: block;
		margin-bottom: var(--space-6);
		text-decoration: none;
		border-radius: var(--radius-sm);
	}

	/* Nav items are quiet by default; only the current one carries the accent so
	   "you are here" reads at a glance. */
	.rail a:not(.brand-link) {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		color: var(--color-ink);
		text-decoration: none;
		font-weight: 600;
	}

	.rail a:not(.brand-link):hover {
		background: var(--color-purple-08);
		color: var(--color-purple);
	}

	.rail a.active {
		background: var(--color-purple-08);
		color: var(--color-purple);
		box-shadow: inset 2px 0 0 var(--color-purple);
	}

	.signout {
		margin-top: auto;
	}

	.signout button {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		font: inherit;
		color: var(--color-ink-65);
		background: none;
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.signout button:hover {
		border-color: var(--color-purple);
		color: var(--color-purple);
	}

	/* Every page lives in a bounded, centered column - no page runs edge to edge.
	   Tool/canvas pages (editor, composer, preview) fill this --tool-width frame;
	   content pages (Reports, Skeletons, Data sets, Settings) re-center their own
	   narrower --content-width column inside it. */
	main {
		min-width: 0;
		width: 100%;
		max-width: var(--tool-width);
		margin-inline: auto;
		padding: var(--space-6) var(--space-7) var(--space-8);
	}
</style>
