import { describe, expect, expectTypeOf, it } from 'vitest';
import { toValidationErrors } from './errors.ts';
import { ICON_NAMES, iconNameSchema, type IconName } from './icons.ts';

describe('iconNameSchema - valid names', () => {
	it('accepts every name in the fixed vocabulary', () => {
		for (const name of ICON_NAMES) {
			const result = iconNameSchema.safeParse(name);
			expect(result.success).toBe(true);
			if (result.success) expectTypeOf(result.data).toEqualTypeOf<IconName>();
		}
	});

	it('declares a non-empty, generic icon set (~8-16 entries)', () => {
		expect(ICON_NAMES.length).toBeGreaterThanOrEqual(8);
		expect(ICON_NAMES.length).toBeLessThanOrEqual(16);
	});

	it('holds no duplicate names', () => {
		expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
	});
});

describe('iconNameSchema - unknown name (FR2)', () => {
	it('rejects a name absent from the vocabulary', () => {
		expect(iconNameSchema.safeParse('rocket').success).toBe(false);
	});

	it('lists the valid names in the actionable error hint', () => {
		const result = iconNameSchema.safeParse('rocket');
		expect(result.success).toBe(false);
		if (!result.success) {
			const [detail] = toValidationErrors(result.error);
			expect(detail.hint).toBeDefined();
			for (const name of ICON_NAMES) {
				expect(detail.hint).toContain(name);
			}
		}
	});
});
