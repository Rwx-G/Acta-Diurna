<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/ui/Button.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let sending = $state(false);
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

		{#if form}
			<p class="result {form.sent ? 'ok' : 'failed'}" role="status">
				<span class="chip {form.sent ? 'ok' : 'failed'}">{form.sent ? 'Sent' : 'Failed'}</span>
				{form.message}
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
</style>
