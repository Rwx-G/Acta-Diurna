<script lang="ts">
	// The Acta Diurna mark: three staggered Doric columns that double as an
	// ascending bar chart - the Roman daily gazette as a reporting instrument.
	// Ink flanks with the tallest column in brand purple. Geometry matches
	// static/favicon.svg exactly so the tab icon and the in-app logo are one
	// mark; inlined (not an <img>) so it stays crisp at every size and the fills
	// read from tokens. Two lockups: `horizontal` for the workspace rail,
	// `stacked` (centered) for the sign-in gateway, `mark` for the glyph alone.
	interface Props {
		layout?: 'horizontal' | 'stacked' | 'mark';
		markSize?: number;
		wordmarkSize?: number;
	}

	let { layout = 'horizontal', markSize = 28, wordmarkSize = 15 }: Props = $props();
</script>

<span class="brand {layout}" aria-label="Acta Diurna">
	<svg
		class="mark"
		width={markSize}
		height={markSize}
		viewBox="0 0 100 100"
		role="img"
		aria-hidden="true"
		focusable="false"
	>
		<!-- stylobate (shared base) -->
		<rect x="6" y="88" width="88" height="5" rx="2" fill="var(--color-ink)" />
		<rect x="11" y="83" width="78" height="4" rx="1.5" fill="var(--color-ink)" />
		<!-- left column (medium) -->
		<g fill="var(--color-ink)">
			<rect x="11.5" y="35" width="23" height="4" rx="1.5" />
			<rect x="14.5" y="39" width="17" height="3.5" rx="1" />
			<rect x="16.5" y="42.5" width="13" height="40.5" />
		</g>
		<!-- center column (tallest, accent) -->
		<g fill="var(--color-purple)">
			<rect x="38.5" y="12" width="23" height="4" rx="1.5" />
			<rect x="41.5" y="16" width="17" height="3.5" rx="1" />
			<rect x="43.5" y="19.5" width="13" height="63.5" />
		</g>
		<!-- right column (short) -->
		<g fill="var(--color-ink)">
			<rect x="65.5" y="52" width="23" height="4" rx="1.5" />
			<rect x="68.5" y="56" width="17" height="3.5" rx="1" />
			<rect x="70.5" y="59.5" width="13" height="23.5" />
		</g>
	</svg>
	{#if layout !== 'mark'}
		<span class="wordmark" style="font-size: {wordmarkSize}px">Acta Diurna</span>
	{/if}
</span>

<style>
	.brand {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
	}

	.brand.stacked {
		flex-direction: column;
		gap: var(--space-3);
	}

	.mark {
		display: block;
		flex-shrink: 0;
	}

	.wordmark {
		font-family: var(--font-wordmark);
		font-weight: 600;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--color-purple);
		line-height: 1;
	}
</style>
