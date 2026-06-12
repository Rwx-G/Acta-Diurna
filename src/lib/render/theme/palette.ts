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

export const THEME_PALETTES: Record<string, ThemePalette> = {
	default: DEFAULT_THEME,
	midnight: MIDNIGHT_THEME
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

export const CATEGORICAL_PALETTES: Record<string, readonly string[]> = {
	default: DEFAULT_CATEGORICAL_PALETTE,
	midnight: MIDNIGHT_CATEGORICAL_PALETTE
};
