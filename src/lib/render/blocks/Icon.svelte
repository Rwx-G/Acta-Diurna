<script lang="ts">
	import type { IconName } from '$lib/schema';
	import { ICON_REGISTRY, ICON_VIEW_BOX } from './icons.ts';

	// The curated inline-SVG icon (Epic 7, Story 7.6): renders the registry glyph
	// for `name` as a single SSR `<svg>` - no icon font, no external/CDN fetch, no
	// new dependency (the self-hosted, no-CDN CSP posture). Zero hydration: static
	// markup, so the reader budget (NFR3) is unaffected.
	//
	// DECORATIVE by contract (`aria-hidden="true"`, `focusable="false"`): the
	// adjacent text always carries the meaning, so the icon is never the sole
	// signal (NFR14). Consumers (callout 7.7, card grid 7.9) place the icon beside
	// a label.
	//
	// Sized and coloured by the surrounding token context: the `<svg>` is `1em`
	// square and strokes in `currentColor`, so a caller controls size via
	// `font-size` and colour via `color` on the parent - no dimension or colour is
	// baked in.
	let { name }: { name: IconName } = $props();

	const paths = $derived(ICON_REGISTRY[name]);
</script>

<svg
	class="icon"
	viewBox={ICON_VIEW_BOX}
	fill="none"
	stroke="currentColor"
	stroke-width="1.75"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
>
	{#each paths as d (d)}
		<path {d} />
	{/each}
</svg>

<style>
	.icon {
		display: inline-block;
		width: 1em;
		height: 1em;
		flex-shrink: 0;
		vertical-align: -0.125em;
	}
</style>
