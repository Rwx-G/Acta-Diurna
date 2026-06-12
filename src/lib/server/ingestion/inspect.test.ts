import { describe, expect, it } from 'vitest';
import { inferColumnType, inferValueType, inspectFields } from './inspect.ts';

describe('inferValueType - precedence', () => {
	it('treats true/false (any case) as boolean before number', () => {
		expect(inferValueType('true')).toBe('boolean');
		expect(inferValueType('FALSE')).toBe('boolean');
		expect(inferValueType(true)).toBe('boolean');
	});

	it('treats finite numeric strings as number', () => {
		expect(inferValueType('42')).toBe('number');
		expect(inferValueType('-3.14')).toBe('number');
		expect(inferValueType('1e3')).toBe('number');
	});

	it('treats ISO dates and date-times as date', () => {
		expect(inferValueType('2026-06-12')).toBe('date');
		expect(inferValueType('2026-06-12T10:30:00Z')).toBe('date');
	});

	it('does not treat a bare year-like number as a date (number wins)', () => {
		expect(inferValueType('2026')).toBe('number');
	});

	it('falls back to string for free text and non-ISO dates', () => {
		expect(inferValueType('hello')).toBe('string');
		expect(inferValueType('06/12/2026')).toBe('string');
		expect(inferValueType('')).toBe('string');
	});

	it('does not treat an empty string as number (Number("") footgun)', () => {
		expect(inferValueType(' ')).toBe('string');
	});
});

describe('inferColumnType - aggregation', () => {
	it('infers number when every non-empty value is numeric', () => {
		expect(inferColumnType(['1', '2', '', '3'])).toBe('number');
	});

	it('falls back to string on mixed non-string types', () => {
		expect(inferColumnType(['1', '2026-06-12'])).toBe('string');
	});

	it('falls back to string when any value is plainly a string', () => {
		expect(inferColumnType(['1', '2', 'n/a'])).toBe('string');
	});

	it('ignores empty values and never promotes from them', () => {
		expect(inferColumnType(['', '', 'true'])).toBe('boolean');
	});

	it('is string for an all-empty column', () => {
		expect(inferColumnType(['', '', ''])).toBe('string');
	});
});

describe('inspectFields', () => {
	it('returns name + inferred type per column in declared order', () => {
		const fields = inspectFields(
			['week', 'count', 'open'],
			[
				{ week: '2026-06-01', count: '3', open: 'true' },
				{ week: '2026-06-08', count: '5', open: 'false' }
			]
		);
		expect(fields).toEqual([
			{ name: 'week', type: 'date' },
			{ name: 'count', type: 'number' },
			{ name: 'open', type: 'boolean' }
		]);
	});
});
