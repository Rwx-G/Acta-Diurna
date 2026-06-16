<script lang="ts" module>
	// Workspace-chrome icon set (editor toolbar + per-block controls). The reader
	// render tier has its own curated `lib/render/blocks/Icon.svelte` bound to the
	// schema `IconName`; this twin serves the WORKSPACE only and is intentionally
	// decoupled from the schema (its names are UI affordances - reorder, remove,
	// undo - never document content), so the two registries evolve independently.
	//
	// Same self-hosted, no-CDN posture as the reader icon: inline SVG, no icon font,
	// no dependency. Each glyph is a 24x24 viewBox of stroke paths and/or filled dots
	// (the drag handle), drawn in `currentColor` at `1em`, so a caller controls size
	// via `font-size` and colour via `color` on the parent.
	type Glyph = { paths?: readonly string[]; dots?: readonly [number, number][] };

	const REGISTRY = {
		'chevron-up': { paths: ['m18 15-6-6-6 6'] },
		'chevron-down': { paths: ['m6 9 6 6 6-6'] },
		'chevron-left': { paths: ['m15 18-6-6 6-6'] },
		'chevron-right': { paths: ['m9 18 6-6-6-6'] },
		x: { paths: ['M18 6 6 18M6 6l12 12'] },
		trash: {
			paths: [
				'M3 6h18',
				'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6',
				'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
				'M10 11v6',
				'M14 11v6'
			]
		},
		// Six filled dots: the conventional drag-handle affordance. Drawn as dots
		// (not strokes) so it reads as a grip, not an icon glyph.
		grip: {
			dots: [
				[9, 6],
				[9, 12],
				[9, 18],
				[15, 6],
				[15, 12],
				[15, 18]
			]
		},
		undo: { paths: ['M9 14 4 9l5-5', 'M4 9h11a5 5 0 0 1 0 10h-1'] },
		redo: { paths: ['m15 14 5-5-5-5', 'M20 9H9a5 5 0 0 0 0 10h1'] },
		panel: {
			paths: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z', 'M15 3v18']
		},
		eye: {
			paths: [
				'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z',
				'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'
			]
		},
		external: {
			paths: [
				'M15 3h6v6',
				'M10 14 21 3',
				'M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5'
			]
		},
		plus: { paths: ['M12 5v14', 'M5 12h14'] },
		save: {
			paths: [
				'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z',
				'M17 21v-8H7v8',
				'M7 3v5h8'
			]
		},
		upload: { paths: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5-5 5 5', 'M12 5v12'] }
	} satisfies Record<string, Glyph>;

	export type UiIconName = keyof typeof REGISTRY;
</script>

<script lang="ts">
	// DECORATIVE by contract (`aria-hidden`, `focusable="false"`): every consumer
	// pairs the icon with a visible label or an `aria-label`/`.sr-only` accessible
	// name on the control, so the icon is never the sole signal (WCAG 1.1.1 / 2.5.3).
	let { name }: { name: UiIconName } = $props();

	const glyph: Glyph = $derived(REGISTRY[name]);
</script>

<svg
	class="ui-icon"
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.75"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
>
	{#each glyph.paths ?? [] as d (d)}
		<path {d} />
	{/each}
	{#each glyph.dots ?? [] as [cx, cy] (`${cx}-${cy}`)}
		<circle {cx} {cy} r="1.5" fill="currentColor" stroke="none" />
	{/each}
</svg>

<style>
	.ui-icon {
		display: inline-block;
		width: 1em;
		height: 1em;
		flex-shrink: 0;
		vertical-align: -0.125em;
	}
</style>
