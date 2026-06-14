/**
 * Theme resolution for the render tier. A document's optional `theme` slug
 * selects a built-in theme; an unknown or absent slug falls back to the
 * default (zero author work, AR10). The renderer applies the result as a
 * `data-theme` attribute, and the semantic `--report-*` tokens in app.css do
 * the rest - no component reads a theme value beyond this attribute (FR39).
 *
 * One registry (`BUILT_IN_THEMES` + `THEME_OPTIONS`) is the single source of
 * truth the schema validation, the workspace theme picker and the renderer all
 * agree on: a new theme is added here once, with its CSS token block in
 * app.css and its hex twins in palette.ts.
 */

export { contrastRatio, relativeLuminance, AA_CONTRAST, AAA_CONTRAST } from './contrast.ts';
export {
	DEFAULT_THEME,
	MIDNIGHT_THEME,
	AURORA_THEME,
	MERIDIAN_THEME,
	THEME_PALETTES,
	type ThemePalette
} from './palette.ts';
export { scaleEntryColor, scaleContrastWarnings, type ScaleContrastWarning } from './scales.ts';

/**
 * The built-in theme names, in picker order. `default` is implicit (no
 * `data-theme` needed); `midnight` is the dark theme; `aurora` and `meridian`
 * are the additional light identities (Story 6.5).
 */
export const BUILT_IN_THEMES = ['default', 'midnight', 'aurora', 'meridian'] as const;

export type ThemeName = (typeof BUILT_IN_THEMES)[number];

/** A built-in theme as offered to the author: the stored slug plus its label. */
export interface ThemeOption {
	name: ThemeName;
	/** Human label for the workspace picker. */
	label: string;
	/** One-line identity hint shown beside the picker. */
	description: string;
}

/**
 * The author-facing registry: every built-in theme with its display label and a
 * one-line identity. The editor theme picker renders exactly these, so an author
 * can only ever select a known theme. Order matches `BUILT_IN_THEMES`.
 */
export const THEME_OPTIONS: readonly ThemeOption[] = [
	{
		name: 'default',
		label: 'Modern Gazette',
		description: 'Stone paper, ink serif, purple accent.'
	},
	{
		name: 'midnight',
		label: 'Midnight',
		description: 'Inverted dark theme for projector reading.'
	},
	{ name: 'aurora', label: 'Cool Aurora', description: 'Cool paper, slate-teal ink, teal accent.' },
	{
		name: 'meridian',
		label: 'Warm Meridian',
		description: 'Cream paper, sepia ink, terracotta accent.'
	}
];

/** True when `slug` names a built-in theme. */
export function isKnownTheme(slug: string | undefined): slug is ThemeName {
	return slug !== undefined && (BUILT_IN_THEMES as readonly string[]).includes(slug);
}

/**
 * Maps a document `theme` slug to a built-in theme name, defaulting to
 * `default` for absent or unrecognized values. Kept total so a stale or
 * future theme reference never throws in the render path (AC3 fallback).
 */
export function resolveTheme(slug: string | undefined): ThemeName {
	return isKnownTheme(slug) ? slug : 'default';
}

/**
 * The single fallback warning a document's `theme` slug raises in the workspace
 * (AC3): a slug that is set but names no built-in theme renders in the default
 * theme and flags the report. Returns null for an absent slug (no selection,
 * the default applies silently per FR39) and for a known slug.
 */
export interface ThemeFallbackWarning {
	requested: string;
	applied: ThemeName;
	message: string;
}

export function themeFallbackWarning(slug: string | undefined): ThemeFallbackWarning | null {
	if (slug === undefined || isKnownTheme(slug)) {
		return null;
	}
	return {
		requested: slug,
		applied: 'default',
		message: `Unknown theme "${slug}"; showing the default theme.`
	};
}
