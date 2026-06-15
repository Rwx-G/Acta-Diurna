import type { BindingDeltaDirection } from '$lib/schema';

/**
 * The decorative up / down / flat glyph shared by the KPI trend chip (`KpiBlock`) and
 * the numeric delta indicator (`KpiDelta`), so the two cannot drift on the arrow they
 * draw. The glyph is `aria-hidden` in both: the meaning rides on each component's own
 * visually-hidden direction word (the SR labels differ - "trending up" for the static
 * trend chip vs "up" for the computed delta - so they stay per-component).
 */
export const DIRECTION_GLYPH = { up: '▲', down: '▼', flat: '▬' } as const satisfies Record<
	BindingDeltaDirection,
	string
>;

/**
 * The visually-hidden direction WORD that carries the meaning the `aria-hidden` glyph
 * cannot (NFR14): the numeric delta indicator (`KpiDelta`) and the change-summary
 * headline movement (`ChangeSummary`) both label a computed delta with the same plain
 * word, so they share one map and cannot drift. The static KPI trend chip
 * (`KpiBlock`) keeps its own "trending up" phrasing - it labels a trend, not a delta.
 */
export const DIRECTION_WORD = {
	up: 'up',
	down: 'down',
	flat: 'no change'
} as const satisfies Record<BindingDeltaDirection, string>;
