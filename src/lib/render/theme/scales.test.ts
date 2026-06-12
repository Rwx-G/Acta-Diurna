import { describe, expect, it } from 'vitest';
import type { Scale, Scales } from '$lib/schema';
import { scaleContrastWarnings, scaleEntryColor } from './scales.ts';
import { DEFAULT_CATEGORICAL_PALETTE, MIDNIGHT_CATEGORICAL_PALETTE } from './palette.ts';
import { AAA_CONTRAST, contrastRatio } from './contrast.ts';

const scale: Scale = {
	key: 'severity',
	label: 'Severity',
	entries: [
		{ key: 'critical', label: 'Critical', color: '#7a2e3a' },
		{ key: 'high', label: 'High' },
		{ key: 'medium', label: 'Medium' }
	]
};

describe('scaleEntryColor', () => {
	it('returns the explicit colour when set', () => {
		expect(scaleEntryColor(scale, 0)).toBe('#7a2e3a');
	});

	it('returns the deterministic palette colour by index when absent', () => {
		expect(scaleEntryColor(scale, 1, 'default')).toBe(DEFAULT_CATEGORICAL_PALETTE[1]);
		expect(scaleEntryColor(scale, 2, 'default')).toBe(DEFAULT_CATEGORICAL_PALETTE[2]);
	});

	it('resolves the palette per theme', () => {
		expect(scaleEntryColor(scale, 1, 'midnight')).toBe(MIDNIGHT_CATEGORICAL_PALETTE[1]);
	});

	it('is stable across calls', () => {
		expect(scaleEntryColor(scale, 2)).toBe(scaleEntryColor(scale, 2));
	});

	it('wraps the palette index modulo its length', () => {
		const longScale: Scale = {
			key: 's',
			label: 'S',
			entries: Array.from({ length: 8 }, (_unused, index) => ({ key: `e${index}`, label: 'E' }))
		};
		expect(scaleEntryColor(longScale, 6, 'default')).toBe(DEFAULT_CATEGORICAL_PALETTE[0]);
		expect(scaleEntryColor(longScale, 7, 'default')).toBe(DEFAULT_CATEGORICAL_PALETTE[1]);
	});
});

describe('scaleContrastWarnings', () => {
	it('flags an explicit hex below AAA on the report background', () => {
		// A pale yellow on the stone background is well below AAA.
		const scales: Scales = [
			{ key: 's', label: 'S', entries: [{ key: 'a', label: 'A', color: '#f0e68c' }] }
		];
		const warnings = scaleContrastWarnings(scales, 'default');
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatchObject({ scaleKey: 's', entryKey: 'a' });
		expect(warnings[0].ratio).toBeLessThan(AAA_CONTRAST);
	});

	it('never flags a default-palette colour (no explicit hex)', () => {
		const scales: Scales = [
			{
				key: 's',
				label: 'S',
				entries: [
					{ key: 'a', label: 'A' },
					{ key: 'b', label: 'B' }
				]
			}
		];
		expect(scaleContrastWarnings(scales, 'default')).toEqual([]);
	});

	it('passes an AAA-compliant explicit hex without warning', () => {
		const ink = '#1c1b2e';
		expect(contrastRatio(ink, '#f5f1e8')).toBeGreaterThanOrEqual(AAA_CONTRAST);
		const scales: Scales = [
			{ key: 's', label: 'S', entries: [{ key: 'a', label: 'A', color: ink }] }
		];
		expect(scaleContrastWarnings(scales, 'default')).toEqual([]);
	});

	it('returns no warnings when scales is absent', () => {
		expect(scaleContrastWarnings(undefined)).toEqual([]);
	});
});
