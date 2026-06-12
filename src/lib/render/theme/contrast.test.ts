import { describe, expect, it } from 'vitest';
import {
	AA_CONTRAST,
	AAA_CONTRAST,
	contrastRatio,
	isBelowAA,
	isBelowAAA,
	relativeLuminance
} from './contrast.ts';
import {
	CATEGORICAL_PALETTES,
	DEFAULT_THEME,
	MIDNIGHT_THEME,
	THEME_PALETTES,
	TONE_PALETTES,
	type ThemePalette
} from './palette.ts';

describe('contrastRatio', () => {
	it('is 21 for black on white', () => {
		expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
	});

	it('is 1 for identical colors', () => {
		expect(contrastRatio('#66023c', '#66023c')).toBeCloseTo(1, 5);
	});

	it('is symmetric', () => {
		expect(contrastRatio('#1c1b2e', '#f5f1e8')).toBeCloseTo(
			contrastRatio('#f5f1e8', '#1c1b2e'),
			10
		);
	});

	it('rejects a malformed hex', () => {
		expect(() => relativeLuminance('purple')).toThrow();
	});

	it('thresholds AA and AAA', () => {
		expect(isBelowAA(4.4)).toBe(true);
		expect(isBelowAA(4.5)).toBe(false);
		expect(isBelowAAA(6.9)).toBe(true);
		expect(isBelowAAA(7)).toBe(false);
	});
});

/**
 * The categorical swatches (Epic 7 scale default colours) are decorative fills -
 * a severity pill, a chart series - not prose, so the AA floor is their contract
 * on every theme's report background (same stance as `accentContrast` on
 * `accent` above). A scale entry left without an explicit colour resolves to one
 * of these, so it never raises the workspace contrast warning: defaults are not
 * fed to `scaleContrastWarnings`, only explicit author hexes are.
 */
describe('categorical palette contrast (AA floor)', () => {
	for (const [theme, palette] of Object.entries(CATEGORICAL_PALETTES)) {
		const bg = THEME_PALETTES[theme].bg;
		palette.forEach((swatch, index) => {
			it(`${theme}: --report-chart-${index + 1} holds AA floor on background`, () => {
				expect(contrastRatio(swatch, bg)).toBeGreaterThanOrEqual(AA_CONTRAST);
			});
		});
	}
});

/**
 * The callout tone accents (story 7.7) are decorative - the callout's left
 * border and its icon + kicker label - not prose (the body text stays
 * `--report-text`/AAA), so the AA floor is their contract on every theme's
 * report background, the same stance as the categorical swatches and the trend
 * colours. The closed tone enum has exactly five entries on every theme.
 */
describe('callout tone palette contrast (AA floor)', () => {
	for (const [theme, palette] of Object.entries(TONE_PALETTES)) {
		const bg = THEME_PALETTES[theme].bg;
		for (const [tone, color] of Object.entries(palette)) {
			it(`${theme}: --report-tone-${tone} holds AA floor on background`, () => {
				expect(contrastRatio(color, bg)).toBeGreaterThanOrEqual(AA_CONTRAST);
			});
		}
		it(`${theme}: exposes the five closed tones`, () => {
			expect(Object.keys(palette).sort()).toEqual([
				'danger',
				'info',
				'neutral',
				'success',
				'warning'
			]);
		});
	}
});

/**
 * Report content is AAA (NFR14): every text-bearing pair holds 7:1. These
 * assertions are the regression gate on the theme tokens - changing a
 * --report-* color in app.css without keeping its luminance compliant fails
 * here, before it ever reaches a reader.
 */
function assertReportContentAAA(name: string, theme: ThemePalette): void {
	const onBg: Array<[string, string]> = [
		['body text on background', theme.text],
		['muted text on background', theme.textMuted],
		['heading on background', theme.heading],
		['accent (links) on background', theme.accent]
	];
	for (const [label, fg] of onBg) {
		it(`${name}: ${label} holds AAA`, () => {
			expect(contrastRatio(fg, theme.bg)).toBeGreaterThanOrEqual(AAA_CONTRAST);
		});
	}

	it(`${name}: body text on surface holds AAA`, () => {
		expect(contrastRatio(theme.text, theme.surface)).toBeGreaterThanOrEqual(AAA_CONTRAST);
	});

	it(`${name}: text on accent fill holds AA floor`, () => {
		// Text sitting on an accent fill (e.g. a pill) is a non-prose decorative
		// surface; the AA floor is the contract there, prose AAA is on background.
		expect(contrastRatio(theme.accentContrast, theme.accent)).toBeGreaterThanOrEqual(AA_CONTRAST);
	});

	// KPI trend glyphs are small report content tinted by direction. They are
	// part of the theme surface (not the workspace-chrome --color-* tokens), so
	// each theme must keep both above the AA floor on its own report background.
	it(`${name}: trend-up holds AA floor on background`, () => {
		expect(contrastRatio(theme.trendUp, theme.bg)).toBeGreaterThanOrEqual(AA_CONTRAST);
	});

	it(`${name}: trend-down holds AA floor on background`, () => {
		expect(contrastRatio(theme.trendDown, theme.bg)).toBeGreaterThanOrEqual(AA_CONTRAST);
	});
}

describe('report theme contrast (AAA)', () => {
	assertReportContentAAA('default', DEFAULT_THEME);
	assertReportContentAAA('midnight', MIDNIGHT_THEME);

	it('exposes both built-in themes (FR39 additivity surface)', () => {
		expect(Object.keys(THEME_PALETTES).sort()).toEqual(['default', 'midnight']);
	});
});
