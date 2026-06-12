/**
 * Render-tier resolution of scale entry colours and the workspace contrast
 * warning surface. Pure (no DOM): the render component and the workspace check
 * both consume these. The schema-side `scales.ts` holds the isomorphic
 * token-name resolution; here we resolve to a concrete hex per theme so the
 * contrast math can run.
 */
import type { Scale, Scales } from '$lib/schema';
import { contrastRatio, isBelowAAA } from './contrast.ts';
import { CATEGORICAL_PALETTES, DEFAULT_CATEGORICAL_PALETTE, THEME_PALETTES } from './palette.ts';

function paletteFor(theme: string): readonly string[] {
	return CATEGORICAL_PALETTES[theme] ?? DEFAULT_CATEGORICAL_PALETTE;
}

/**
 * The resolved hex for a scale entry on a given theme: the explicit
 * `entry.color` when set, else the deterministic categorical swatch indexed by
 * the entry's position in the scale (modulo the palette length). Stable across
 * renders for a fixed document, mirroring `chart-geometry.ts`
 * `colorIndex = seriesIndex % MAX_COLORS`.
 */
export function scaleEntryColor(scale: Scale, entryIndex: number, theme = 'default'): string {
	const explicit = scale.entries[entryIndex]?.color;
	if (explicit !== undefined) {
		return explicit;
	}
	const palette = paletteFor(theme);
	const slot = ((entryIndex % palette.length) + palette.length) % palette.length;
	return palette[slot];
}

/** One explicit author colour that falls below AAA on the report background. */
export interface ScaleContrastWarning {
	scaleKey: string;
	entryKey: string;
	ratio: number;
}

/**
 * Returns a warning for every EXPLICIT author hex that sits below AAA on the
 * theme's report background (FR39 "AAA default, author may degrade"). This is a
 * workspace surface, NOT a render gate: the document still validates and renders
 * in the author's colour. Only entries with an explicit `color` are checked, so
 * a default-palette swatch never warns.
 */
export function scaleContrastWarnings(
	scales: Scales | undefined,
	theme = 'default'
): ScaleContrastWarning[] {
	const background = (THEME_PALETTES[theme] ?? THEME_PALETTES.default).bg;
	const warnings: ScaleContrastWarning[] = [];
	for (const scale of scales ?? []) {
		for (const entry of scale.entries) {
			if (entry.color === undefined) {
				continue;
			}
			const ratio = contrastRatio(entry.color, background);
			if (isBelowAAA(ratio)) {
				warnings.push({ scaleKey: scale.key, entryKey: entry.key, ratio });
			}
		}
	}
	return warnings;
}
