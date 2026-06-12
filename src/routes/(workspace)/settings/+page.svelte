<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { formatUtcDateTime } from '$lib/format';
	import Button from '$lib/ui/Button.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let sending = $state(false);

	// The test-send action returns `{ sent, message }`; the token actions return
	// `{ token: ... }`. Discriminate so each result renders under its own section.
	const testResult = $derived(form && 'sent' in form ? form : null);
	const tokenResult = $derived(form && 'token' in form ? form.token : null);
	const newToken = $derived(
		tokenResult && 'created' in tokenResult && tokenResult.created ? tokenResult : null
	);
	const tokenError = $derived(
		tokenResult && 'created' in tokenResult && !tokenResult.created ? tokenResult.message : null
	);

	let creating = $state(false);
	let copied = $state(false);

	async function copyToken(raw: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(raw);
			copied = true;
			setTimeout(() => (copied = false), 3000);
		} catch {
			copied = false;
		}
	}

	// Two-click destructive confirm for revocation, the same pattern as the share
	// list: first click arms ("Confirm revoke?"), second within 5s submits.
	let confirmingRevokeId = $state<string | null>(null);
	let confirmRevokeTimer: ReturnType<typeof setTimeout>;
	const confirmRevoke: SubmitFunction = ({ formData, cancel }) => {
		const id = String(formData.get('tokenId'));
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
</script>

<svelte:head>
	<title>Settings - Acta Diurna</title>
</svelte:head>

<header class="head">
	<h1>Settings</h1>
	<p class="lede">Configure and verify the channels Acta Diurna uses to reach your readers.</p>
</header>

<section class="panel">
	<h2>Email delivery</h2>

	{#if data.smtp}
		<p class="status">
			<span class="chip ok">SMTP configured</span>
			Sending as <strong>{data.smtp.from}</strong> over
			<strong>{data.smtp.tlsMode}</strong>.
		</p>

		<form
			method="POST"
			action="?/test-send"
			class="test-form"
			use:enhance={() => {
				sending = true;
				return async ({ update }) => {
					await update({ reset: false });
					sending = false;
				};
			}}
		>
			<label for="to">Send a test email to</label>
			<div class="row">
				<input
					id="to"
					name="to"
					type="email"
					placeholder="you@example.com"
					required
					disabled={sending}
				/>
				<Button type="submit" variant="primary" disabled={sending}>
					{sending ? 'Sending...' : 'Send test email'}
				</Button>
			</div>
		</form>

		{#if testResult}
			<p class="result {testResult.sent ? 'ok' : 'failed'}" role="status">
				<span class="chip {testResult.sent ? 'ok' : 'failed'}"
					>{testResult.sent ? 'Sent' : 'Failed'}</span
				>
				{testResult.message}
			</p>
		{/if}
	{:else}
		<p class="status">
			<span class="chip off">SMTP not configured</span>
		</p>
		<p class="hint">
			Set <code>SMTP_HOST</code>, <code>SMTP_PORT</code> and <code>SMTP_FROM</code> (plus
			<code>SMTP_USER</code> / <code>SMTP_PASSWORD</code> for an authenticated relay and
			<code>SMTP_TLS_MODE</code>) in your environment, then restart. Magic links for readers cannot
			be delivered until the relay is configured.
		</p>
	{/if}
</section>

<section class="panel">
	<h2>API tokens</h2>
	<p class="lede">
		Personal access tokens let your scripts and agents authenticate to the API. Send a token as
		<code>Authorization: Bearer &lt;token&gt;</code>. A token is shown once at creation and stored
		hashed - it is never displayed again.
	</p>

	<form
		method="POST"
		action="?/create-token"
		class="test-form"
		use:enhance={() => {
			creating = true;
			return async ({ update }) => {
				await update({ reset: true });
				creating = false;
			};
		}}
	>
		<label for="token-name">Token name</label>
		<div class="row">
			<input
				id="token-name"
				name="name"
				type="text"
				placeholder="CI deploy script"
				required
				disabled={creating}
			/>
			<Button type="submit" variant="primary" disabled={creating}>
				{creating ? 'Creating...' : 'Create token'}
			</Button>
		</div>
	</form>

	{#if tokenError}
		<p class="result failed" role="status">
			<span class="chip failed">Failed</span>
			{tokenError}
		</p>
	{/if}

	{#if newToken}
		<div class="created" role="status">
			<p class="created-label">Your new token "{newToken.name}" (shown once - copy it now):</p>
			<div class="created-row">
				<code class="created-url">{newToken.raw}</code>
				<Button variant="secondary" type="button" onclick={() => copyToken(newToken.raw)}>
					{copied ? 'Copied' : 'Copy token'}
				</Button>
			</div>
			<p class="hint">
				This is the only time the token is displayed. It is not stored - only a hash of it. If you
				lose it, revoke it and create a new one.
			</p>
		</div>
	{/if}

	<div class="token-list">
		{#if data.tokens.length === 0}
			<p class="muted">No API tokens yet.</p>
		{:else}
			<ul>
				{#each data.tokens as token (token.id)}
					<li>
						<div class="token-row">
							<span class="chip {token.status === 'active' ? 'ok' : 'off'}">{token.status}</span>
							<span class="token-name">{token.name}</span>
							<span class="meta">…{token.displayFragment}</span>
							<span class="meta">Created {formatUtcDateTime(token.createdAt)}</span>
							<span class="meta">
								{#if token.lastUsedAt}
									Last used {formatUtcDateTime(token.lastUsedAt)}
								{:else}
									Never used
								{/if}
							</span>
							{#if token.status === 'active'}
								<form
									method="POST"
									action="?/revoke-token"
									use:enhance={confirmRevoke}
									class="revoke-form"
								>
									<input type="hidden" name="tokenId" value={token.id} />
									<button type="submit" class="link-action danger">
										{confirmingRevokeId === token.id ? 'Confirm revoke?' : 'Revoke'}
									</button>
								</form>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</section>

<style>
	.head {
		max-width: 880px;
		margin-bottom: var(--space-5);
	}

	.lede {
		color: var(--color-ink-65);
	}

	.panel {
		max-width: 880px;
		padding: var(--space-5);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-sm);
	}

	.panel h2 {
		margin: 0 0 var(--space-4);
		font-size: 16px;
	}

	.status {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		color: var(--color-ink-65);
	}

	.chip {
		display: inline-block;
		padding: 2px var(--space-3);
		font-size: 12px;
		font-weight: 600;
		border-radius: var(--radius-pill);
	}

	.chip.ok {
		color: var(--color-green);
		background: var(--color-green-12);
	}

	.chip.failed {
		color: var(--color-danger);
		background: var(--color-danger-08);
	}

	.chip.off {
		color: var(--color-ink-65);
		background: var(--color-ink-12);
	}

	.test-form {
		margin-top: var(--space-4);
	}

	.test-form label {
		display: block;
		margin-bottom: var(--space-2);
		font-weight: 600;
	}

	.row {
		display: flex;
		gap: var(--space-3);
		align-items: center;
	}

	.row input {
		flex: 1;
		padding: var(--space-2) var(--space-3);
		font: inherit;
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
	}

	.result {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin-top: var(--space-4);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-sm);
	}

	.result.ok {
		background: var(--color-green-12);
	}

	.result.failed {
		background: var(--color-danger-08);
		color: var(--color-danger);
	}

	.hint {
		margin-top: var(--space-3);
		color: var(--color-ink-65);
	}

	.hint code {
		font-size: 13px;
		padding: 0 var(--space-1);
		background: var(--color-surface);
		border-radius: var(--radius-sm);
	}

	.lede code {
		font-size: 13px;
		padding: 0 var(--space-1);
		background: var(--color-surface);
		border-radius: var(--radius-sm);
	}

	.created {
		margin-top: var(--space-4);
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

	.token-list {
		margin-top: var(--space-5);
	}

	.token-list ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.token-list li {
		padding: var(--space-3) var(--space-4);
		background: var(--color-surface);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-sm);
		margin-bottom: var(--space-2);
	}

	.token-row {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		flex-wrap: wrap;
	}

	.token-name {
		font-size: 13px;
		font-weight: 600;
	}

	.meta {
		color: var(--color-ink-65);
		font-size: 12px;
	}

	.revoke-form {
		margin: 0 0 0 auto;
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

	.muted {
		color: var(--color-ink-65);
	}
</style>
