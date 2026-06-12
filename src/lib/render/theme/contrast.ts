/**
 * WCAG 2.1 relative-luminance contrast, pure math (no DOM). Used by the token
 * contrast tests to assert the report-content pairs hold AAA (7:1) and the
 * workspace pairs hold the AA floor (4.5:1). Inputs are 6-digit hex strings.
 */

function channelLuminance(channel: number): number {
	const c = channel / 255;
	return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Relative luminance of a `#rrggbb` color per WCAG 2.1. */
export function relativeLuminance(hex: string): number {
	const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
	if (!match) throw new Error(`Expected a #rrggbb hex color, got: ${hex}`);
	const value = Number.parseInt(match[1], 16);
	const r = (value >> 16) & 0xff;
	const g = (value >> 8) & 0xff;
	const b = value & 0xff;
	return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** Contrast ratio (1..21) between two `#rrggbb` colors. */
export function contrastRatio(foreground: string, background: string): number {
	const a = relativeLuminance(foreground);
	const b = relativeLuminance(background);
	const lighter = Math.max(a, b);
	const darker = Math.min(a, b);
	return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AAA normal-text threshold. */
export const AAA_CONTRAST = 7;

/** WCAG AA normal-text threshold. */
export const AA_CONTRAST = 4.5;

/** True when `ratio` sits below the WCAG AA normal-text floor (4.5:1). */
export function isBelowAA(ratio: number): boolean {
	return ratio < AA_CONTRAST;
}

/** True when `ratio` sits below the WCAG AAA normal-text floor (7:1). */
export function isBelowAAA(ratio: number): boolean {
	return ratio < AAA_CONTRAST;
}
