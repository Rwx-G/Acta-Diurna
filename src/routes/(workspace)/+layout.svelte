<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Brand from '$lib/ui/Brand.svelte';
	import type { LayoutData } from './$types';
	// Shared per-block-editor form-field base and the `.sr-only` accessible-name
	// helper, scoped under `.block-card`. Imported at the workspace layout (never a
	// reader route), so they add zero reader-path bytes (NFR3).
	import './reports/[id]/edit/form-fields.css';
	import './reports/[id]/edit/sr-only.css';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

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
			href={resolve('/(workspace)/audit')}
			class:active={active('/audit')}
			aria-current={active('/audit') ? 'page' : undefined}>Access audit</a
		>
		<a
			href={resolve('/(workspace)/settings')}
			class:active={active('/settings')}
			aria-current={active('/settings') ? 'page' : undefined}>Settings</a
		>

		<!-- Account block. In multi mode the logged-in author's email is shown above
		     sign out; in single mode the password author is anonymous, so only the
		     button renders (data.authorEmail is null) and the rail is unchanged. -->
		<div class="account">
			{#if data.authorEmail}
				<p class="identity" title={data.authorEmail}>
					<span class="identity-label">Signed in as</span>
					<span class="identity-email">{data.authorEmail}</span>
				</p>
			{/if}
			<!-- Relative ?/logout: every workspace page exposes the shared logout action. -->
			<form method="POST" action="?/logout" class="signout">
				<button type="submit">Sign out</button>
			</form>
		</div>
	</nav>
	<main>{@render children()}</main>
</div>

<style>
	.workspace {
		display: grid;
		grid-template-columns: 216px 1fr;
		min-height: 100vh;
	}

	/* The rail stays pinned while the page scrolls: a grid cell otherwise
	   stretches to the full content height and the nav scrolls away with it.
	   `align-self: start` opts out of that stretch so the 100vh sticky box has
	   room to move; `overflow-y: auto` lets the rail's own content scroll on a
	   viewport too short to hold it (account block included). */
	.rail {
		position: sticky;
		top: 0;
		align-self: start;
		height: 100vh;
		/* border-box so the 100vh INCLUDES the padding: with the default content-box
		   the padding stacks on top of 100vh, making the rail taller than the
		   viewport - which scrolls even a short page and pushes the bottom-anchored
		   sign-out below the fold (there is no global box-sizing reset). */
		box-sizing: border-box;
		overflow-y: auto;
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

	.account {
		margin-top: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.identity {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: 0;
		padding: 0 var(--space-3);
	}

	.identity-label {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-ink-50);
	}

	.identity-email {
		font-weight: 600;
		color: var(--color-ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
