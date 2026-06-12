<svelte:head>
	<title>Reports - Acta Diurna</title>
</svelte:head>

<header>
	<p class="wordmark">Acta Diurna</p>
	<form method="POST" action="?/logout">
		<button type="submit">Sign out</button>
	</form>
</header>

<main>
	<h1>Reports</h1>
	<!-- The reports list lands with story 1.5; until then the workspace opens empty. -->
	<p class="empty">No reports yet.</p>
</main>

<style>
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3) var(--space-5);
		border-bottom: 1px solid var(--color-ink-12);
		background: var(--color-surface);
	}

	.wordmark {
		margin: 0;
		font-family: var(--font-wordmark);
		font-size: 16px;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--color-purple);
	}

	header button {
		padding: var(--space-1) var(--space-3);
		font: inherit;
		color: var(--color-ink);
		background: none;
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	header button:hover {
		border-color: var(--color-purple);
		color: var(--color-purple);
	}

	main {
		max-width: 880px;
		margin: 0 auto;
		padding: var(--space-6) var(--space-5);
	}

	h1 {
		margin: 0 0 var(--space-4);
		font-size: 20px;
	}

	.empty {
		color: var(--color-ink-65);
	}
</style>
