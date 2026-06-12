/**
 * The inline-SVG icon registry (Epic 7, Story 7.6). One entry per
 * `iconNameSchema` name, drawn as a list of `<path d="...">` on a 24x24 grid -
 * the markup `Icon.svelte` stamps at render. Stroke-only, single-weight glyphs
 * in the project's line language (compare `Brand.svelte`): every path inherits
 * `stroke="currentColor"` and the round cap/join from the `<svg>`, so an icon
 * takes its colour and size entirely from the surrounding token context, with no
 * colour baked in here.
 *
 * Modelled as path-`d` data (NOT raw SVG strings) so `Icon.svelte` renders real
 * `<path>` elements through Svelte - never `{@html}` - keeping the renderer-purity
 * boundary intact. The registry MUST cover exactly the `ICON_NAMES` enum (no
 * missing, no extra); the lockstep test (`Icon.svelte.test.ts`) holds them in
 * step.
 *
 * Pure render data: this module imports only the icon-name type from the
 * isomorphic schema, nothing from `$lib/server`.
 */
import type { IconName } from '$lib/schema';

/** The path `d` strings that compose one glyph, drawn in document order. */
export type IconPaths = readonly string[];

/**
 * The 24x24 view box every glyph is drawn on. Exposed for the `<svg viewBox>` so
 * the registry geometry and the component frame stay in one place.
 */
export const ICON_VIEW_BOX = '0 0 24 24';

export const ICON_REGISTRY: Record<IconName, IconPaths> = {
	check: ['M5 13l4 4L19 7'],
	cross: ['M6 6l12 12', 'M18 6L6 18'],
	alert: ['M12 4L2.5 20.5h19L12 4z', 'M12 10v4', 'M12 17.5v.5'],
	info: ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M12 11v5', 'M12 8v.5'],
	question: [
		'M12 21a9 9 0 100-18 9 9 0 000 18z',
		'M9.5 9a2.5 2.5 0 113.5 2.3c-.9.5-1 1-1 2',
		'M12 17v.5'
	],
	'arrow-right': ['M4 12h15', 'M13 6l6 6-6 6'],
	clock: ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M12 7v5l3.5 2'],
	database: [
		'M12 7c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3z',
		'M20 4v8c0 1.7-3.6 3-8 3s-8-1.3-8-3V4',
		'M20 12v8c0 1.7-3.6 3-8 3s-8-1.3-8-3v-8'
	],
	shield: ['M12 2.5l7.5 3v6c0 4.6-3.2 8.4-7.5 9.5-4.3-1.1-7.5-4.9-7.5-9.5v-6l7.5-3z'],
	bolt: ['M13 2L4.5 13.5H11L9.5 22 19.5 10H13l1-8z'],
	flag: ['M5 21V4', 'M5 4h11l-2 3.5L16 11H5'],
	link: ['M9.5 14.5l5-5', 'M8 12l-2 2a3.5 3.5 0 005 5l2-2', 'M16 12l2-2a3.5 3.5 0 00-5-5l-2 2']
};
