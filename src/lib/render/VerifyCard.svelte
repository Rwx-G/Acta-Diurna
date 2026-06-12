<script lang="ts">
	// Themed reader verification gateway (UX Flow C). A branded card, never a
	// generic auth wall: it carries the report theme via the same `--report-*`
	// tokens the renderer uses, applied through a `data-theme` attribute. SSR-
	// complete and JS-light - the email form is a plain progressively-enhanced
	// POST (no heavy hydration), so this stays well inside the reader JS budget.
	//
	// States (NFR9): `prompt` asks for the email; `sent` is the neutral
	// confirmation shown for ANY email (known, unknown, or unauthorized - the
	// caller never tells us which); `expired` is the "request a new link" landing
	// for a used/expired magic link; `invalid` is a client-side shape error on the
	// reader's own typed email (not an authorization signal); `throttled` is the
	// rate-limit message.
	import type { ThemeName } from './theme/index.ts';

	interface Props {
		state: 'prompt' | 'sent' | 'expired' | 'invalid' | 'throttled';
		/** Resolved theme for branded styling; defaults to the neutral theme. */
		theme?: ThemeName;
		/** The action path for the email form (the route's request-verification action). */
		action?: string;
	}

	let { state, theme = 'default', action = '?/request-verification' }: Props = $props();
</script>

<div class="gateway" data-theme={theme === 'default' ? undefined : theme}>
	<div class="card" role="region" aria-label="Verify your email to read this report">
		<p class="wordmark">ACTA DIURNA</p>

		{#if state === 'sent'}
			<h1>Check your email</h1>
			<p class="lead">
				If this address can access the report, a single-use link is on its way. It is valid for 15
				minutes.
			</p>
		{:else if state === 'expired'}
			<h1>This link has expired</h1>
			<p class="lead">
				Magic links are single-use and valid for 15 minutes. Request a fresh one below.
			</p>
			<form method="POST" {action} class="email-form">
				<label for="email">Your email</label>
				<input
					id="email"
					name="email"
					type="email"
					autocomplete="email"
					required
					placeholder="you@example.com"
				/>
				<button type="submit">Send a new link</button>
			</form>
		{:else}
			<h1>Enter your email to read this report</h1>
			<p class="lead">
				This report is shared securely. Verify your email once, then read freely - no account
				needed.
			</p>
			{#if state === 'invalid'}
				<p class="notice" role="alert">
					That does not look like an email address. Check and retry.
				</p>
			{:else if state === 'throttled'}
				<p class="notice" role="alert">Too many attempts. Wait a moment, then try again.</p>
			{/if}
			<form method="POST" {action} class="email-form">
				<label for="email">Your email</label>
				<input
					id="email"
					name="email"
					type="email"
					autocomplete="email"
					required
					placeholder="you@example.com"
				/>
				<button type="submit">Send my link</button>
			</form>
		{/if}
	</div>
</div>

<style>
	.gateway {
		display: grid;
		place-items: center;
		min-height: 100dvh;
		padding: var(--space-6);
		background: var(--report-bg, var(--color-surface));
		color: var(--report-text, var(--color-ink));
	}

	.card {
		width: 100%;
		max-width: 28rem;
		padding: var(--space-7) var(--space-6);
		background: var(--report-surface, var(--color-bg));
		border: 1px solid var(--report-rule, var(--color-ink-12));
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
	}

	.wordmark {
		margin: 0 0 var(--space-5);
		font-family: var(--font-display, 'Cinzel', serif);
		font-size: var(--text-sm);
		letter-spacing: 0.18em;
		color: var(--report-accent, var(--color-purple));
	}

	h1 {
		margin: 0 0 var(--space-3);
		font-size: var(--text-xl);
		line-height: 1.2;
	}

	.lead {
		margin: 0 0 var(--space-5);
		color: var(--report-text, var(--color-ink-65));
	}

	.notice {
		margin: 0 0 var(--space-4);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--color-red, crimson) 12%, transparent);
		color: var(--color-red, crimson);
		font-size: var(--text-sm);
	}

	.email-form {
		display: grid;
		gap: var(--space-2);
	}

	label {
		font-size: var(--text-sm);
		font-weight: 600;
	}

	input {
		padding: var(--space-3);
		font: inherit;
		color: var(--report-text, var(--color-ink));
		background: var(--report-bg, var(--color-surface));
		border: 1px solid var(--report-rule, var(--color-ink-25));
		border-radius: var(--radius-sm);
	}

	input:focus-visible {
		outline: 2px solid var(--report-accent, var(--color-purple));
		outline-offset: 2px;
	}

	button {
		margin-top: var(--space-2);
		padding: var(--space-3) var(--space-4);
		font: inherit;
		font-weight: 600;
		color: var(--color-bg, white);
		background: var(--report-accent, var(--color-purple));
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	button:hover {
		filter: brightness(1.05);
	}

	button:focus-visible {
		outline: 2px solid var(--report-text, var(--color-ink));
		outline-offset: 2px;
	}
</style>
