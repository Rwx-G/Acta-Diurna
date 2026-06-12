/**
 * Theme resolution for the render tier. A document's optional `theme` slug
 * selects a built-in theme; an unknown or absent slug falls back to the
 * default (zero author work, AR10). The renderer applies the result as a
 * `data-theme` attribute, and the semantic `--report-*` tokens in app.css do
 * the rest - no component reads a theme value beyond this attribute (FR39).
 */

export { contrastRatio, relativeLuminance, AA_CONTRAST, AAA_CONTRAST } from './contrast.ts';
export { DEFAULT_THEME, MIDNIGHT_THEME, THEME_PALETTES, type ThemePalette } from './palette.ts';

/** The built-in theme names. `default` is implicit (no `data-theme` needed). */
export const BUILT_IN_THEMES = ['default', 'midnight'] as const;

export type ThemeName = (typeof BUILT_IN_THEMES)[number];

/**
 * Maps a document `theme` slug to a built-in theme name, defaulting to
 * `default` for absent or unrecognized values. Kept total so a stale or
 * future theme reference never throws in the render path.
 */
export function resolveTheme(slug: string | undefined): ThemeName {
	if (slug && (BUILT_IN_THEMES as readonly string[]).includes(slug)) {
		return slug as ThemeName;
	}
	return 'default';
}
