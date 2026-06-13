<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { formatUtcDateTime } from '$lib/format';
	import Button from '$lib/ui/Button.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const isPublished = $derived(data.report.status === 'published');
	// Mode-aware sharing (story 8.4). MULTI (SMTP): the restricted/open + recipient
	// controls render. SINGLE (no SMTP): shares are consultation tokens - opening
	// the link grants read access with no email verification, so the restricted
	// and recipient controls are hidden and the page explains the behavior.
	const isMulti = $derived(data.multi);

	let copied = $state(false);
	// Mirror the create-form mode selector so the recipient field shows only for a
	// restricted share (open shares have no allow-list, FR19). Multi mode only.
	let createMode = $state<'restricted' | 'open'>('restricted');

	// Two-click destructive confirm for revocation (FR20), the same pattern as the
	// reports-list delete: the first click arms (label -> "Confirm revoke?"), the
	// second within 5s submits. Revocation is irreversible, so a stray click must
	// not cut a live link.
	let confirmingRevokeId = $state<string | null>(null);
	let confirmRevokeTimer: ReturnType<typeof setTimeout>;
	const confirmRevoke: SubmitFunction = ({ formData, cancel }) => {
		const id = String(formData.get('shareId'));
		if (confirmingRevokeId !== id) {
			cancel();
			confirmingRevokeId = id;
			clearTimeout(confirmRevokeTimer);
			confirmRevokeTimer = setTimeout(() => (confirmingRevokeId = null), 5000);
			return;
		}
		clearTimeout(confirmRevokeTimer);
		confirmingRevokeId = null;
		return async ({ update }) => {
			await update();
		};
	};

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
		{#if !isMulti}
			<p class="hint consultation-note">
				This instance has no SMTP configured, so a share link is a consultation token: anyone with
				the link can open the report directly, with no email verification. Restricted, per-recipient
				sharing needs SMTP. Expiry and one-click revocation still apply.
			</p>
		{/if}
		<form method="POST" action="?/create-share" use:enhance>
			<div class="field">
				<label for="expiresAt">Expires at (UTC, optional)</label>
				<input id="expiresAt" name="expiresAt" type="datetime-local" />
				<p class="hint">Leave blank for a link with no time bound.</p>
			</div>
			{#if isMulti}
				<div class="field">
					<label for="mode">Access</label>
					<select id="mode" name="mode" bind:value={createMode}>
						<option value="restricted">Restricted (recipient list)</option>
						<option value="open">Open (anyone with the link)</option>
					</select>
				</div>
				{#if createMode === 'restricted'}
					<div class="field">
						<label for="recipients">Recipients</label>
						<textarea
							id="recipients"
							name="recipients"
							rows="3"
							placeholder="alice@example.com, bob@example.com"
						></textarea>
						<p class="hint">
							One email per line or comma-separated. Only these addresses can verify and read. You
							can edit this list later.
						</p>
					</div>
				{:else}
					<p class="hint open-note">
						Anyone with the link who verifies their email may read. Their identity is recorded.
					</p>
				{/if}
			{/if}
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
						<div class="share-row">
							<span class="chip {share.status}">{share.status}</span>
							<span class="mode">{isMulti ? share.mode : 'consultation'}</span>
							<span class="meta">Created {formatUtcDateTime(share.createdAt)}</span>
							<span class="meta">
								{#if share.expiresAt}
									Expires {formatUtcDateTime(share.expiresAt)}
								{:else}
									No expiry
								{/if}
							</span>
							{#if share.status === 'active'}
								{#if isMulti}
									<form method="POST" action="?/set-mode" use:enhance class="mode-toggle">
										<input type="hidden" name="shareId" value={share.id} />
										<input
											type="hidden"
											name="mode"
											value={share.mode === 'restricted' ? 'open' : 'restricted'}
										/>
										<button type="submit" class="link-action">
											Switch to {share.mode === 'restricted' ? 'open' : 'restricted'}
										</button>
									</form>
								{/if}
								<form
									method="POST"
									action="?/revoke-share"
									use:enhance={confirmRevoke}
									class="revoke-form"
								>
									<input type="hidden" name="shareId" value={share.id} />
									<button type="submit" class="link-action danger">
										{confirmingRevokeId === share.id ? 'Confirm revoke?' : 'Revoke'}
									</button>
								</form>
							{/if}
						</div>

						{#if isMulti && share.mode === 'restricted'}
							<form method="POST" action="?/set-recipients" use:enhance class="recipients-editor">
								<input type="hidden" name="shareId" value={share.id} />
								<label for="recipients-{share.id}">Recipient allow-list</label>
								<textarea id="recipients-{share.id}" name="recipients" rows="3"
									>{share.recipients.join('\n')}</textarea
								>
								<div class="recipients-actions">
									<Button variant="secondary" type="submit">Save recipients</Button>
									<span class="meta">{share.recipients.length} listed</span>
								</div>
							</form>
						{:else if isMulti}
							<p class="hint open-note">Open: anyone with the link who verifies may read.</p>
						{:else}
							<p class="hint open-note">Consultation: anyone with the link can open the report.</p>
						{/if}
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
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		background: var(--color-surface);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-sm);
		margin-bottom: var(--space-2);
	}

	.share-row {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		flex-wrap: wrap;
	}

	.mode-toggle {
		margin-left: auto;
	}

	.link-action {
		padding: 0;
		font: inherit;
		font-size: 12px;
		color: var(--color-purple);
		background: none;
		border: none;
		cursor: pointer;
		text-decoration: underline;
	}

	.link-action.danger {
		color: var(--color-danger);
	}

	.revoke-form {
		margin: 0;
	}

	.recipients-editor {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.recipients-editor label {
		font-size: 12px;
	}

	.recipients-editor textarea {
		padding: var(--space-2) var(--space-3);
		font: inherit;
		font-size: 13px;
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		resize: vertical;
	}

	.recipients-actions {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.open-note {
		margin: 0;
	}

	.consultation-note {
		margin: 0 0 var(--space-4);
		max-width: 520px;
	}

	textarea {
		padding: var(--space-2) var(--space-3);
		font: inherit;
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		resize: vertical;
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
