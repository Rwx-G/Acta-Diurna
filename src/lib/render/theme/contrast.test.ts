import { describe, expect, it } from 'vitest';
import { AA_CONTRAST, AAA_CONTRAST, contrastRatio, relativeLuminance } from './contrast.ts';
import { DEFAULT_THEME, MIDNIGHT_THEME, THEME_PALETTES, type ThemePalette } from './palette.ts';

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
