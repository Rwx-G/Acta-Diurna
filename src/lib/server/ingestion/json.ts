/**
 * JSON ingestion: stdlib `JSON.parse` plus a tabular-shape check. The only
 * accepted shape is an array of flat objects (a record set). The column set is
 * the union of the objects' keys, in first-seen order. Non-tabular JSON (a bare
 * object, an array of scalars, an array of arrays, nested object values) is
 * rejected with a clear `ParseError`, never silently coerced.
 */
import { ParseError } from './errors.ts';

export interface JsonTable {
	columns: string[];
	rows: Record<string, unknown>[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): boolean {
	return (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	);
}

/** Parses JSON text into a tabular `{ columns, rows }` or throws a ParseError. */
export function parseJson(text: string): JsonTable {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new ParseError('Malformed JSON: the file is not valid JSON.', 'format');
	}

	if (!Array.isArray(parsed)) {
		throw new ParseError(
			'Unsupported JSON shape: expected an array of records (objects).',
			'format'
		);
	}
	if (parsed.length === 0) {
		throw new ParseError('Empty JSON: the array of records is empty.', 'format');
	}

	const columns: string[] = [];
	const seen = new Set<string>();
	const rows: Record<string, unknown>[] = [];

	for (let i = 0; i < parsed.length; i++) {
		const entry = parsed[i];
		if (!isPlainObject(entry)) {
			throw new ParseError(`Unsupported JSON shape: record ${i} is not an object.`, 'format');
		}
		for (const [key, value] of Object.entries(entry)) {
			if (!isScalar(value)) {
				throw new ParseError(
					`Unsupported JSON shape: record ${i} field "${key}" is nested, not a scalar.`,
					'format'
				);
			}
			if (!seen.has(key)) {
				seen.add(key);
				columns.push(key);
			}
		}
		rows.push(entry);
	}

	return { columns, rows };
}
