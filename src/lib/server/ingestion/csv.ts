/**
 * RFC 4180 CSV parser (hand-written: "three lines beats a premature
 * dependency", and Excel-parser packages are parked - see backlog "Excel
 * parser dependency choice"). Handles quoted fields, embedded commas and
 * newlines, escaped double-quotes (`""`), and CRLF or LF line endings. The
 * first record is the header row; remaining records become objects keyed by
 * the header names. Returns `{ columns, rows }` for the inspector and resolver.
 */
import { ParseError } from './errors.ts';

export interface CsvTable {
	/** Header names, in file order. */
	columns: string[];
	/** One record per data row, keyed by header name. */
	rows: Record<string, string>[];
}

/**
 * Splits CSV text into records of string fields. A field is quoted iff it opens
 * with `"`; inside a quoted field a doubled `""` is a literal quote and commas
 * and newlines are data. Unquoted fields end at the next comma or line break.
 */
function tokenize(text: string): string[][] {
	const records: string[][] = [];
	let record: string[] = [];
	let field = '';
	let inQuotes = false;
	let fieldStarted = false;
	let sawAnyChar = false;

	const pushField = (): void => {
		record.push(field);
		field = '';
		fieldStarted = false;
	};
	const pushRecord = (): void => {
		pushField();
		records.push(record);
		record = [];
	};

	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		sawAnyChar = true;

		if (inQuotes) {
			if (char === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				field += char;
			}
			continue;
		}

		if (char === '"' && !fieldStarted) {
			inQuotes = true;
			fieldStarted = true;
			continue;
		}
		if (char === ',') {
			pushField();
			continue;
		}
		if (char === '\r') {
			if (text[i + 1] === '\n') i++;
			pushRecord();
			continue;
		}
		if (char === '\n') {
			pushRecord();
			continue;
		}
		field += char;
		fieldStarted = true;
	}

	if (inQuotes) {
		throw new ParseError('Malformed CSV: an opening quote is never closed.', 'format');
	}
	// Flush the final record unless the file ended exactly on a line break (no
	// trailing empty record) or is entirely empty.
	if (sawAnyChar && (field.length > 0 || record.length > 0)) {
		pushRecord();
	}
	return records;
}

/** Parses CSV text into a header + keyed rows table. */
export function parseCsv(text: string): CsvTable {
	const records = tokenize(text);
	if (records.length === 0) {
		throw new ParseError('Empty CSV: no header row found.', 'format');
	}
	const columns = records[0];
	if (columns.some((name) => name.trim().length === 0)) {
		throw new ParseError('Malformed CSV: a header column name is empty.', 'format');
	}
	const seen = new Set<string>();
	for (const name of columns) {
		if (seen.has(name)) {
			throw new ParseError(`Malformed CSV: duplicate header column "${name}".`, 'format');
		}
		seen.add(name);
	}

	const rows: Record<string, string>[] = [];
	for (let r = 1; r < records.length; r++) {
		const cells = records[r];
		const row: Record<string, string> = {};
		for (let c = 0; c < columns.length; c++) {
			row[columns[c]] = cells[c] ?? '';
		}
		rows.push(row);
	}
	return { columns, rows };
}
