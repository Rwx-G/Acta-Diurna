/**
 * Resolved hex values of the report-content color tokens, per theme. The CSS
 * source of truth is `src/app.css`; these literals mirror the semantic
 * `--report-*` tokens so the contrast tests can assert the AAA/AA targets
 * without a browser. When a token in app.css changes, update its twin here and
 * the contrast test will re-check the ratio.
 *
 * Only opaque, text-bearing report tokens are mirrored - rules and decorative
 * fills are not contrast-gated against text. Muted text on midnight resolves
 * the `color-mix` rule indirectly; the values below are the flat colors.
 */

export interface ThemePalette {
	bg: string;
	surface: string;
	text: string;
	textMuted: string;
	heading: string;
	accent: string;
	accentContrast: string;
}

export const DEFAULT_THEME: ThemePalette = {
	bg: '#f5f1e8', // --report-bg (stone)
	surface: '#fffdf9', // --report-surface
	text: '#1c1b2e', // --report-text (ink)
	textMuted: '#4a4960', // --report-text-muted
	heading: '#1c1b2e', // --report-heading
	accent: '#66023c', // --report-accent (imperial purple)
	accentContrast: '#f5f1e8' // --report-accent-contrast
};

export const MIDNIGHT_THEME: ThemePalette = {
	bg: '#14131f', // --report-bg
	surface: '#1c1b2e', // --report-surface
	text: '#f3efe4', // --report-text
	textMuted: '#b9b4c4', // --report-text-muted
	heading: '#fbf8f0', // --report-heading
	accent: '#e090b8', // --report-accent (lightened for AAA on dark)
	accentContrast: '#14131f' // --report-accent-contrast
};

export const THEME_PALETTES: Record<string, ThemePalette> = {
	default: DEFAULT_THEME,
	midnight: MIDNIGHT_THEME
};
