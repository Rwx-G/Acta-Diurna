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
		expect(inferValueType('-0.5')).toBe('number');
		expect(inferValueType('.5')).toBe('number');
		expect(inferValueType('+5')).toBe('number');
	});

	it('keeps a single 0 a number but a leading-zero integer a string (padded id/zip)', () => {
		expect(inferValueType('0')).toBe('number');
		expect(inferValueType('007')).toBe('string');
		expect(inferValueType('00')).toBe('string');
		// 4-digit, no leading zero, stays a number (year-like).
		expect(inferValueType('2026')).toBe('number');
	});

	it('rejects hex/binary/octal literals as numbers (string)', () => {
		expect(inferValueType('0x1F')).toBe('string');
		expect(inferValueType('0b101')).toBe('string');
		expect(inferValueType('0o17')).toBe('string');
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

	it('infers each column independently in a single pass over mixed rows', () => {
		// One pass over the rows must yield the same per-column types as folding each
		// column's values separately: a clean number column, a date column, a column
		// pinned to string by one free-text cell, a column pinned to string by a type
		// disagreement, and a column whose only non-empty value decides its type.
		const fields = inspectFields(
			['amount', 'day', 'note', 'mixed', 'sparse'],
			[
				{ amount: '10', day: '2026-06-01', note: '5', mixed: '1', sparse: '' },
				{ amount: '20', day: '2026-06-02', note: 'n/a', mixed: '2026-06-02', sparse: 'true' },
				{ amount: '30', day: '2026-06-03', note: '7', mixed: '3', sparse: '' }
			]
		);
		expect(fields).toEqual([
			{ name: 'amount', type: 'number' },
			{ name: 'day', type: 'date' },
			{ name: 'note', type: 'string' },
			{ name: 'mixed', type: 'string' },
			{ name: 'sparse', type: 'boolean' }
		]);
	});

	it('agrees with per-column folding (single-pass equivalence)', () => {
		const columns = ['a', 'b', 'c'];
		const rows: Record<string, unknown>[] = [
			{ a: '1', b: 'true', c: '2026-06-01' },
			{ a: '', b: 'false', c: 'free text' },
			{ a: '2', b: '', c: '2026-06-02' }
		];
		const single = inspectFields(columns, rows);
		const perColumn = columns.map((name) => ({
			name,
			type: inferColumnType(rows.map((row) => row[name]))
		}));
		expect(single).toEqual(perColumn);
	});
});
