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
