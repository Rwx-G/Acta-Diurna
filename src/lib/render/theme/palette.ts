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
	trendUp: string;
	trendDown: string;
}

export const DEFAULT_THEME: ThemePalette = {
	bg: '#f5f1e8', // --report-bg (stone)
	surface: '#fffdf9', // --report-surface
	text: '#1c1b2e', // --report-text (ink)
	textMuted: '#4a4960', // --report-text-muted
	heading: '#1c1b2e', // --report-heading
	accent: '#66023c', // --report-accent (imperial purple)
	accentContrast: '#f5f1e8', // --report-accent-contrast
	trendUp: '#2f6b4a', // --report-trend-up
	trendDown: '#a23b3b' // --report-trend-down
};

export const MIDNIGHT_THEME: ThemePalette = {
	bg: '#14131f', // --report-bg
	surface: '#1c1b2e', // --report-surface
	text: '#f3efe4', // --report-text
	textMuted: '#b9b4c4', // --report-text-muted
	heading: '#fbf8f0', // --report-heading
	accent: '#e090b8', // --report-accent (lightened for AAA on dark)
	accentContrast: '#14131f', // --report-accent-contrast
	trendUp: '#6fbf95', // --report-trend-up (lightened for AA on dark)
	trendDown: '#f08a8a' // --report-trend-down (lightened for AA on dark)
};

// "Cool Aurora": a glacial, analytical identity - cool paper, slate-teal ink,
// a deep teal accent. Reads calm and precise; suits dashboards and data-led
// reports. Accent is darkened to clear AAA (7:1) on the cool paper.
export const AURORA_THEME: ThemePalette = {
	bg: '#eef3f4', // --report-bg
	surface: '#ffffff', // --report-surface
	text: '#15232b', // --report-text
	textMuted: '#3f5560', // --report-text-muted (7.0:1 on bg)
	heading: '#10242e', // --report-heading
	accent: '#08526a', // --report-accent (7.7:1 on bg, AAA)
	accentContrast: '#eef3f4', // --report-accent-contrast
	trendUp: '#1f6a52', // --report-trend-up
	trendDown: '#a23b3b' // --report-trend-down
};

// "Warm Meridian": a warm editorial identity - amber paper, sepia ink, a rust
// terracotta accent. Reads inviting and human; suits narrative-led reports. The
// paper is markedly warmer than the default stone so the theme is distinct at a
// glance; the accent is darkened to clear AAA (7:1) on that warmer paper.
export const MERIDIAN_THEME: ThemePalette = {
	bg: '#f8edd5', // --report-bg
	surface: '#fffaef', // --report-surface
	text: '#2a2018', // --report-text
	textMuted: '#5a4636', // --report-text-muted (7.6:1 on bg)
	heading: '#241a12', // --report-heading
	accent: '#8a2a10', // --report-accent (7.5:1 on bg, AAA)
	accentContrast: '#f8edd5', // --report-accent-contrast
	trendUp: '#2f6b4a', // --report-trend-up
	trendDown: '#a23b3b' // --report-trend-down
};

export const THEME_PALETTES: Record<string, ThemePalette> = {
	default: DEFAULT_THEME,
	midnight: MIDNIGHT_THEME,
	aurora: AURORA_THEME,
	meridian: MERIDIAN_THEME
};

/**
 * Hex twins of the `--report-chart-1..6` categorical swatches, per theme. These
 * mirror the CSS tokens in `src/app.css`; the render component emits
 * `var(--report-chart-N)` (see `scales.ts` `categoricalToken`), and the tests
 * assert the hex here so the default-colour contrast can be checked without a
 * browser. Update a token in app.css and its twin here together; the contrast
 * test re-checks the AAA target.
 *
 * These are decorative swatches (severity pills, chart series), not prose, so
 * the AA floor is their contract on each theme's report background (see
 * `contrast.test.ts`). A default-palette scale colour never raises a contrast
 * warning regardless: `scaleContrastWarnings` only checks explicit author hexes.
 */
export const DEFAULT_CATEGORICAL_PALETTE: readonly string[] = [
	'#66023c', // --report-chart-1
	'#2f6b4a', // --report-chart-2
	'#1c4a7e', // --report-chart-3
	'#8a5a13', // --report-chart-4
	'#5a4a78', // --report-chart-5
	'#7a2e3a' // --report-chart-6
];

export const MIDNIGHT_CATEGORICAL_PALETTE: readonly string[] = [
	'#c876a0', // --report-chart-1
	'#6fbf95', // --report-chart-2
	'#6ea8e0', // --report-chart-3
	'#d6a85a', // --report-chart-4
	'#a99bd0', // --report-chart-5
	'#e08a96' // --report-chart-6
];

export const AURORA_CATEGORICAL_PALETTE: readonly string[] = [
	'#08526a', // --report-chart-1 (matches the accent)
	'#1f6a52', // --report-chart-2
	'#7a3a86', // --report-chart-3
	'#8a5a13', // --report-chart-4
	'#345b8c', // --report-chart-5
	'#9a2f57' // --report-chart-6
];

export const MERIDIAN_CATEGORICAL_PALETTE: readonly string[] = [
	'#8a2a10', // --report-chart-1 (matches the accent)
	'#2f6b4a', // --report-chart-2
	'#1c4a7e', // --report-chart-3
	'#7a5a13', // --report-chart-4
	'#6a4a86', // --report-chart-5
	'#8a2f3a' // --report-chart-6
];

export const CATEGORICAL_PALETTES: Record<string, readonly string[]> = {
	default: DEFAULT_CATEGORICAL_PALETTE,
	midnight: MIDNIGHT_CATEGORICAL_PALETTE,
	aurora: AURORA_CATEGORICAL_PALETTE,
	meridian: MERIDIAN_CATEGORICAL_PALETTE
};

/**
 * Hex twins of the `--report-tone-{info,success,warning,danger,neutral}` callout
 * accent tokens (story 7.7), per theme. These mirror the CSS tokens in
 * `src/app.css`; the callout renderer emits the token (via the tone class), and
 * the contrast test asserts the hex here so the accent's AA floor on each theme's
 * report background can be checked without a browser. Update a token in app.css
 * and its twin here together; the contrast test re-checks the floor.
 *
 * These are decorative accents (the callout's left border and its icon + kicker
 * label), not prose - the body text stays `--report-text`/AAA - so the AA floor
 * is their contract on each theme's report background, the same stance as the
 * KPI trend colours.
 */
export const DEFAULT_TONE_PALETTE: Record<string, string> = {
	info: '#1c4a7e', // --report-tone-info
	success: '#2f6b4a', // --report-tone-success
	warning: '#8a5a13', // --report-tone-warning
	danger: '#a23b3b', // --report-tone-danger
	neutral: '#4a4960' // --report-tone-neutral
};

export const MIDNIGHT_TONE_PALETTE: Record<string, string> = {
	info: '#6ea8e0', // --report-tone-info
	success: '#6fbf95', // --report-tone-success
	warning: '#d6a85a', // --report-tone-warning
	danger: '#f08a8a', // --report-tone-danger
	neutral: '#b9b4c4' // --report-tone-neutral
};

export const AURORA_TONE_PALETTE: Record<string, string> = {
	info: '#1c5a8e', // --report-tone-info
	success: '#1f6a52', // --report-tone-success
	warning: '#8a5a13', // --report-tone-warning
	danger: '#a23b3b', // --report-tone-danger
	neutral: '#3f5560' // --report-tone-neutral
};

export const MERIDIAN_TONE_PALETTE: Record<string, string> = {
	info: '#1c5a8e', // --report-tone-info
	success: '#2f6b4a', // --report-tone-success
	warning: '#7a5a13', // --report-tone-warning
	danger: '#a23b3b', // --report-tone-danger
	neutral: '#5a4636' // --report-tone-neutral
};

export const TONE_PALETTES: Record<string, Record<string, string>> = {
	default: DEFAULT_TONE_PALETTE,
	midnight: MIDNIGHT_TONE_PALETTE,
	aurora: AURORA_TONE_PALETTE,
	meridian: MERIDIAN_TONE_PALETTE
};
