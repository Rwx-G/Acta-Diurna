/**
 * Column inspection: infers a `string | number | date | boolean` type per
 * column from its observed values. Used by both the CSV path (all values are
 * strings) and the JSON path (values may already be typed).
 *
 * Per-VALUE inference precedence (most specific first):
 *   1. boolean  - exactly `true`/`false` (case-insensitive), or a JS boolean.
 *   2. number   - a finite JS number, or a string that is a finite numeric
 *                 literal (no thousands separators, no currency).
 *   3. date     - an ISO-8601 date or date-time string (`YYYY-MM-DD`, optional
 *                 `THH:MM[:SS]` and zone), parseable by Date.
 *   4. string   - anything else, including empty.
 *
 * Per-COLUMN aggregation: a column's type is the single non-string type that
 * every non-empty value matches; any disagreement (mixed types, or one value
 * that is plainly a string) falls back to `string`. Empty values are ignored
 * for inference but never promote a column. A column with no non-empty value is
 * `string`. Deterministic: the same input always yields the same type.
 */
import type { DataSetField } from '$lib/server/db/schema';

export type FieldType = DataSetField['type'];

const ISO_DATE_PATTERN =
	/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

// Plain decimal or scientific notation only. `Number()` would accept hex
// (`0x1F`), binary (`0b101`), octal (`0o17`) and turn zero-padded ids/zips
// (`007`) into numbers, losing their string meaning; those must stay strings.
const DECIMAL_NUMBER_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

// A multi-digit integer with a leading zero (`007`, `00`) is an identifier
// pattern (zip, padded id), not a number. A single `0` and any value with a
// decimal point or exponent are fine.
const LEADING_ZERO_INTEGER_PATTERN = /^[+-]?0\d+$/;

function isFiniteNumberString(value: string): boolean {
	// Reject empty and whitespace-only; Number('') is 0, a footgun here.
	if (value.trim().length === 0) return false;
	if (!DECIMAL_NUMBER_PATTERN.test(value)) return false;
	if (LEADING_ZERO_INTEGER_PATTERN.test(value)) return false;
	return Number.isFinite(Number(value));
}

function isIsoDateString(value: string): boolean {
	if (!ISO_DATE_PATTERN.test(value)) return false;
	return !Number.isNaN(Date.parse(value));
}

/** The narrowest type a single value matches, per the precedence above. */
export function inferValueType(value: unknown): FieldType {
	if (typeof value === 'boolean') return 'boolean';
	if (typeof value === 'number') return Number.isFinite(value) ? 'number' : 'string';
	if (typeof value !== 'string') return 'string';

	const trimmed = value.trim();
	const lower = trimmed.toLowerCase();
	if (lower === 'true' || lower === 'false') return 'boolean';
	if (isFiniteNumberString(trimmed)) return 'number';
	if (isIsoDateString(trimmed)) return 'date';
	return 'string';
}

function isEmpty(value: unknown): boolean {
	return (
		value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
	);
}

/** Aggregates a column of values into one inferred type. */
export function inferColumnType(values: readonly unknown[]): FieldType {
	let agreed: FieldType | undefined;
	for (const value of values) {
		if (isEmpty(value)) continue;
		const type = inferValueType(value);
		if (type === 'string') return 'string';
		if (agreed === undefined) {
			agreed = type;
		} else if (agreed !== type) {
			return 'string';
		}
	}
	return agreed ?? 'string';
}

/**
 * Inspects a list of column names against keyed rows, returning the inferred
 * field type for each column in declared order.
 */
export function inspectFields(
	columns: readonly string[],
	rows: readonly Record<string, unknown>[]
): DataSetField[] {
	return columns.map((name) => ({
		name,
		type: inferColumnType(rows.map((row) => row[name]))
	}));
}
