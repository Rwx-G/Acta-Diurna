<script lang="ts">
	// The single themed error page, and - critically - the leak-free NEUTRAL page
	// for closed share links (FR20/NFR9, story 3.5). A revoked, expired, or
	// never-existed share token all reach `serveNeutralClosed`, which throws
	// `error(404, 'Not Found')`; SvelteKit renders THIS component for all three.
	//
	// It leaks NOTHING: not the report title, not the reason a link is closed, not
	// even whether the token ever matched a share. The copy is one generic line
	// and the markup does NOT interpolate the error status or message, so the three
	// closed states are byte-for-byte identical (the enumeration-safety crux). It
	// carries the reader theme via the same `--report-*` tokens the renderer and
	// VerifyCard use, so the page is branded, never a raw framework error screen.
	//
	// It also serves as the app-wide fallback error page; a generic "not available"
	// is the right message for an unauthenticated reader and harmless elsewhere.
</script>

<svelte:head>
	<title>Acta Diurna</title>
	<!-- Reader-surface error pages are private artifacts; keep them out of indexes
	     (NFR10). The X-Robots-Tag header on /r/* is the header-only backstop. -->
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="neutral">
	<div class="card" role="region" aria-label="This link is not available">
		<p class="wordmark">ACTA DIURNA</p>
		<h1>This link is not available</h1>
		<p class="lead">
			The link you followed cannot be opened. If someone shared it with you, ask them for a current
			one.
		</p>
	</div>
</div>

<style>
	.neutral {
		display: grid;
		place-items: center;
		min-height: 100dvh;
		padding: var(--space-6);
		background: var(--report-bg, var(--color-stone));
		color: var(--report-text, var(--color-ink));
	}

	.card {
		width: 100%;
		max-width: 28rem;
		padding: var(--space-7) var(--space-6);
		background: var(--report-surface, var(--color-surface));
		border: 1px solid var(--report-rule, var(--color-ink-12));
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		text-align: left;
	}

	.wordmark {
		margin: 0 0 var(--space-5);
		font-family: var(--font-wordmark, 'Cinzel', serif);
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
		margin: 0;
		color: var(--report-text, var(--color-ink-65));
	}
</style>
