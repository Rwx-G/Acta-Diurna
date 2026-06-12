import { describe, expect, it } from 'vitest';
import { ParseError } from './errors.ts';
import { parseJson } from './json.ts';

describe('parseJson', () => {
	it('parses an array of flat objects', () => {
		const table = parseJson('[{"item":"apples","count":3},{"item":"pears","count":5}]');
		expect(table.columns).toEqual(['item', 'count']);
		expect(table.rows).toHaveLength(2);
		expect(table.rows[0]).toEqual({ item: 'apples', count: 3 });
	});

	it('unions keys across records in first-seen order', () => {
		const table = parseJson('[{"a":1},{"b":2},{"a":3,"c":4}]');
		expect(table.columns).toEqual(['a', 'b', 'c']);
	});

	it('rejects malformed JSON', () => {
		expect(() => parseJson('{not json')).toThrow(ParseError);
	});

	it('rejects a bare object (not an array)', () => {
		expect(() => parseJson('{"a":1}')).toThrow(ParseError);
	});

	it('rejects an array of scalars', () => {
		expect(() => parseJson('[1,2,3]')).toThrow(ParseError);
	});

	it('rejects an empty array', () => {
		expect(() => parseJson('[]')).toThrow(ParseError);
	});

	it('rejects a nested (non-scalar) field value', () => {
		expect(() => parseJson('[{"a":{"nested":true}}]')).toThrow(ParseError);
	});

	it('rejects an array containing a non-object record', () => {
		expect(() => parseJson('[{"a":1},5]')).toThrow(ParseError);
	});
});
