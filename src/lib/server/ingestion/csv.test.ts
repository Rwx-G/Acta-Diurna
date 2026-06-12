import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv.ts';
import { ParseError } from './errors.ts';

describe('parseCsv', () => {
	it('parses a simple header + rows table', () => {
		const table = parseCsv('item,count\napples,3\npears,5');
		expect(table.columns).toEqual(['item', 'count']);
		expect(table.rows).toEqual([
			{ item: 'apples', count: '3' },
			{ item: 'pears', count: '5' }
		]);
	});

	it('handles CRLF line endings', () => {
		const table = parseCsv('a,b\r\n1,2\r\n3,4\r\n');
		expect(table.rows).toEqual([
			{ a: '1', b: '2' },
			{ a: '3', b: '4' }
		]);
	});

	it('preserves an embedded comma inside a quoted field', () => {
		const table = parseCsv('name,note\n"Doe, Jane",hello');
		expect(table.rows[0]).toEqual({ name: 'Doe, Jane', note: 'hello' });
	});

	it('preserves an embedded newline inside a quoted field', () => {
		const table = parseCsv('name,note\n"line1\nline2",ok');
		expect(table.rows).toHaveLength(1);
		expect(table.rows[0].note).toBe('ok');
		expect(table.rows[0].name).toBe('line1\nline2');
	});

	it('unescapes a doubled double-quote', () => {
		const table = parseCsv('quote\n"she said ""hi"""');
		expect(table.rows[0].quote).toBe('she said "hi"');
	});

	it('treats a trailing newline as no extra empty record', () => {
		const table = parseCsv('a\n1\n2\n');
		expect(table.rows).toHaveLength(2);
	});

	it('pads short rows with empty strings for missing trailing columns', () => {
		const table = parseCsv('a,b,c\n1,2');
		expect(table.rows[0]).toEqual({ a: '1', b: '2', c: '' });
	});

	it('rejects an unterminated quoted field', () => {
		expect(() => parseCsv('a\n"oops')).toThrow(ParseError);
	});

	it('rejects an empty header column name', () => {
		expect(() => parseCsv('a,,c\n1,2,3')).toThrow(ParseError);
	});

	it('rejects a duplicate header column', () => {
		expect(() => parseCsv('a,a\n1,2')).toThrow(ParseError);
	});

	it('rejects an entirely empty file', () => {
		expect(() => parseCsv('')).toThrow(ParseError);
	});

	it('strips a leading UTF-8 BOM so the first column name is clean', () => {
		// The most common real-world CSV: a Windows/Excel UTF-8 export prepends a
		// BOM (U+FEFF). It must not glue onto the first header name.
		const bom = String.fromCharCode(0xfeff);
		const table = parseCsv(`${bom}item,count\napples,3`);
		expect(table.columns).toEqual(['item', 'count']);
		// A binding keyed on the first column resolves against the clean name.
		expect(table.rows[0].item).toBe('apples');
	});
});
