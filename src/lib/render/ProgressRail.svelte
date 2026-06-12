<script lang="ts">
	// A thin purple position indicator pinned to the top edge. Fades when the
	// reader is idle (chrome-minimal "Modern Gazette" direction); under reduced
	// motion it does not fade. Decorative: the real position is announced by the
	// section header's "n / total".
	interface Props {
		progress: number;
		idle: boolean;
	}

	let { progress, idle }: Props = $props();
	const clamped = $derived(Math.min(1, Math.max(0, progress)));
</script>

<div class="rail" class:idle aria-hidden="true">
	<div class="fill" style="transform: scaleX({clamped})"></div>
</div>

<style>
	.rail {
		position: fixed;
		inset: 0 0 auto 0;
		height: 3px;
		background: var(--report-rule);
		z-index: 30;
		transition: opacity 0.4s ease;
	}

	.rail.idle {
		opacity: 0;
	}

	.fill {
		height: 100%;
		background: var(--report-accent-fill);
		transform-origin: left center;
		transition: transform 0.25s ease;
	}

	@media (prefers-reduced-motion: reduce) {
		.rail.idle {
			opacity: 1;
		}

		.fill {
			transition: none;
		}
	}
</style>
