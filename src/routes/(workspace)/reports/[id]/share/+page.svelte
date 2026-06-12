<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { formatUtcDateTime } from '$lib/format';
	import Button from '$lib/ui/Button.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const isPublished = $derived(data.report.status === 'published');

	let copied = $state(false);

	async function copyLink(url: string): Promise<void> {
		// The raw token lives only in this URL and only on this action result; the
		// copy gesture is the one-shot handoff (UX Flow B: "link copied in one
		// gesture"). Reloading the page loses it - by design, it is never re-fetched.
		try {
			await navigator.clipboard.writeText(url);
			copied = true;
			setTimeout(() => (copied = false), 3000);
		} catch {
			copied = false;
		}
	}

	const editPath = $derived(resolve('/(workspace)/reports/[id]/edit', { id: data.report.id }));
</script>

<svelte:head>
	<title>Share {data.report.title} - Acta Diurna</title>
</svelte:head>

<div class="page-header">
	<div>
		<a href={editPath} class="back">&larr; Back to editor</a>
		<h1>Share &ldquo;{data.report.title}&rdquo;</h1>
	</div>
</div>

{#if !isPublished}
	<EmptyState
		title="Publish this report before sharing"
		description="A share link serves the published version of a report. Publish the draft first, then come back here to generate a link."
	>
		<a href={editPath} class="link-button">Go to the editor</a>
	</EmptyState>
{:else}
	<section class="create">
		<h2>Create a share link</h2>
		<form method="POST" action="?/create-share" use:enhance>
			<div class="field">
				<label for="expiresAt">Expires at (UTC, optional)</label>
				<input id="expiresAt" name="expiresAt" type="datetime-local" />
				<p class="hint">Leave blank for a link with no time bound.</p>
			</div>
			<div class="field">
				<label for="mode">Access</label>
				<select id="mode" name="mode">
					<option value="restricted" selected>Restricted (recipient list)</option>
					<option value="open">Open (anyone with the link)</option>
				</select>
			</div>
			<Button variant="primary" type="submit">Generate link</Button>
		</form>

		{#if form?.message}
			<p class="problem" role="alert">{form.message}</p>
		{/if}

		{#if form?.created}
			<div class="created" role="status">
				<p class="created-label">Your share link (shown once - copy it now):</p>
				<div class="created-row">
					<code class="created-url">{form.created.url}</code>
					<Button variant="secondary" type="button" onclick={() => copyLink(form.created.url)}>
						{copied ? 'Copied' : 'Copy link'}
					</Button>
				</div>
				<p class="hint">
					This is the only time the full link is displayed. The link itself is not stored - only a
					hash of it. If you lose it, generate a new one.
				</p>
			</div>
		{/if}
	</section>

	<section class="existing">
		<h2>Existing share links</h2>
		{#if data.shares.length === 0}
			<p class="muted">No share links yet.</p>
		{:else}
			<ul class="share-list">
				{#each data.shares as share (share.id)}
					<li>
						<span class="chip {share.status}">{share.status}</span>
						<span class="mode">{share.mode}</span>
						<span class="meta">Created {formatUtcDateTime(share.createdAt)}</span>
						<span class="meta">
							{#if share.expiresAt}
								Expires {formatUtcDateTime(share.expiresAt)}
							{:else}
								No expiry
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}

<style>
	.page-header {
		margin-bottom: var(--space-5);
	}

	.back {
		display: inline-block;
		margin-bottom: var(--space-2);
		color: var(--color-ink-65);
		font-size: 13px;
		text-decoration: none;
	}

	.back:hover {
		color: var(--color-purple);
	}

	h1 {
		margin: 0;
		font-size: 20px;
	}

	h2 {
		margin: 0 0 var(--space-3);
		font-size: 15px;
	}

	section {
		margin-bottom: var(--space-6);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-bottom: var(--space-4);
		max-width: 360px;
	}

	label {
		font-size: 13px;
		font-weight: 600;
		color: var(--color-ink);
	}

	input,
	select {
		padding: var(--space-2) var(--space-3);
		font: inherit;
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
	}

	.hint {
		margin: var(--space-1) 0 0;
		font-size: 12px;
		color: var(--color-ink-65);
	}

	.problem {
		margin-top: var(--space-4);
		padding: var(--space-3) var(--space-4);
		color: var(--color-danger);
		background: var(--color-danger-08);
		border-radius: var(--radius-sm);
	}

	.created {
		margin-top: var(--space-5);
		padding: var(--space-4);
		border: 1px solid var(--color-green-12);
		background: var(--color-green-12);
		border-radius: var(--radius-sm);
	}

	.created-label {
		margin: 0 0 var(--space-2);
		font-weight: 600;
	}

	.created-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.created-url {
		flex: 1;
		min-width: 0;
		overflow-x: auto;
		padding: var(--space-2) var(--space-3);
		background: var(--color-surface);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-sm);
		font-family: ui-monospace, monospace;
		font-size: 13px;
		white-space: nowrap;
	}

	.muted {
		color: var(--color-ink-65);
	}

	.share-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.share-list li {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
		background: var(--color-surface);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-sm);
		margin-bottom: var(--space-2);
	}

	.chip {
		display: inline-block;
		padding: 2px var(--space-3);
		font-size: 12px;
		font-weight: 600;
		text-transform: capitalize;
		border-radius: var(--radius-pill);
	}

	.chip.active {
		color: var(--color-green);
		background: var(--color-green-12);
	}

	.chip.expired,
	.chip.revoked {
		color: var(--color-ink-65);
		background: var(--color-ink-12);
	}

	.mode {
		font-size: 13px;
		font-weight: 600;
		text-transform: capitalize;
	}

	.meta {
		color: var(--color-ink-65);
		font-size: 12px;
	}

	.link-button {
		display: inline-block;
		padding: var(--space-2) var(--space-4);
		font-weight: 600;
		color: var(--color-stone);
		background: var(--color-purple);
		border-radius: var(--radius-sm);
		text-decoration: none;
	}
</style>
