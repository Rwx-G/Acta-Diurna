<script lang="ts">
	// The report cover - the reader's first 10 seconds. Editorial gazette
	// masthead: a hairline-ruled wordmark eyebrow, the report title in large
	// serif, and a thin purple rule. Sobriety over decoration (Modern Gazette).
	interface Props {
		title: string;
		sectionCount: number;
	}

	let { title, sectionCount }: Props = $props();
</script>

<div class="cover">
	<p class="masthead">Acta Diurna</p>
	<div class="rule"></div>
	<h1 class="cover-title">{title}</h1>
	<p class="cover-meta">
		{sectionCount}
		{sectionCount === 1 ? 'section' : 'sections'}
	</p>
</div>

<style>
	.cover {
		padding: var(--space-6) 0 var(--space-7);
		margin-bottom: var(--space-6);
		border-bottom: 1px solid var(--report-rule);
		text-align: center;
	}

	.masthead {
		margin: 0 0 var(--space-4);
		font-family: var(--font-wordmark);
		font-size: var(--text-sm);
		font-weight: 600;
		letter-spacing: 0.32em;
		text-transform: uppercase;
		color: var(--report-accent);
	}

	.rule {
		width: 64px;
		height: 2px;
		margin: 0 auto var(--space-5);
		background: var(--report-accent-fill);
	}

	.cover-title {
		margin: 0;
		font-family: var(--font-serif);
		font-size: var(--text-3xl);
		font-weight: 600;
		line-height: var(--leading-tight);
		letter-spacing: -0.01em;
		color: var(--report-heading);
	}

	.cover-meta {
		margin: var(--space-4) 0 0;
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--report-text-muted);
	}

	@media (min-width: 768px) {
		.cover-title {
			font-size: var(--text-4xl);
		}
	}
</style>
