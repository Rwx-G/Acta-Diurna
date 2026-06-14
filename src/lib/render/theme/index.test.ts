import { describe, expect, it } from 'vitest';
import {
	BUILT_IN_THEMES,
	THEME_OPTIONS,
	isKnownTheme,
	resolveTheme,
	themeFallbackWarning
} from './index.ts';
import { CATEGORICAL_PALETTES, THEME_PALETTES, TONE_PALETTES } from './palette.ts';

describe('theme registry (one source of truth)', () => {
	it('lists the four built-in themes in picker order', () => {
		expect([...BUILT_IN_THEMES]).toEqual(['default', 'midnight', 'aurora', 'meridian']);
	});

	it('offers a labelled option for every built-in theme, in order', () => {
		expect(THEME_OPTIONS.map((option) => option.name)).toEqual([...BUILT_IN_THEMES]);
		for (const option of THEME_OPTIONS) {
			expect(option.label.length).toBeGreaterThan(0);
			expect(option.description.length).toBeGreaterThan(0);
		}
	});

	it('offers only known themes to the author (editor cannot select an unknown)', () => {
		// The editor picker renders exactly THEME_OPTIONS, so a new author selection
		// is always a known theme; the unknown-theme path (AC3) only arises from a
		// pre-existing/removed stored value, never a fresh selection.
		for (const option of THEME_OPTIONS) {
			expect(isKnownTheme(option.name)).toBe(true);
		}
	});

	it('keeps the palette, categorical and tone tables in lockstep with the registry', () => {
		// The schema, the selector and the renderer agree only if every registered
		// theme has a complete token set in each table - a missing theme would
		// render a half-skinned report.
		const registry = [...BUILT_IN_THEMES].sort();
		expect(Object.keys(THEME_PALETTES).sort()).toEqual(registry);
		expect(Object.keys(CATEGORICAL_PALETTES).sort()).toEqual(registry);
		expect(Object.keys(TONE_PALETTES).sort()).toEqual(registry);
	});
});

describe('isKnownTheme', () => {
	it('accepts every built-in theme', () => {
		for (const theme of BUILT_IN_THEMES) {
			expect(isKnownTheme(theme)).toBe(true);
		}
	});

	it('rejects an unknown slug and undefined', () => {
		expect(isKnownTheme('nebula')).toBe(false);
		expect(isKnownTheme(undefined)).toBe(false);
	});
});

describe('resolveTheme (AC1, AC3 fallback)', () => {
	it('resolves a selected built-in theme to itself', () => {
		expect(resolveTheme('aurora')).toBe('aurora');
		expect(resolveTheme('meridian')).toBe('meridian');
		expect(resolveTheme('midnight')).toBe('midnight');
	});

	it('falls back to the default when no theme is selected (FR39)', () => {
		expect(resolveTheme(undefined)).toBe('default');
	});

	it('falls back to the default for an unknown/removed theme (AC3)', () => {
		expect(resolveTheme('removed-theme')).toBe('default');
	});

	it('is total - never throws on any string', () => {
		expect(() => resolveTheme('whatever')).not.toThrow();
	});
});

describe('themeFallbackWarning (AC3 workspace flag)', () => {
	it('returns null for an absent selection (default applies silently)', () => {
		expect(themeFallbackWarning(undefined)).toBeNull();
	});

	it('returns null for a known theme', () => {
		expect(themeFallbackWarning('aurora')).toBeNull();
	});

	it('flags an unknown theme with the requested slug and the applied default', () => {
		const warning = themeFallbackWarning('nebula');
		expect(warning).not.toBeNull();
		expect(warning?.requested).toBe('nebula');
		expect(warning?.applied).toBe('default');
		expect(warning?.message).toContain('nebula');
	});
});
