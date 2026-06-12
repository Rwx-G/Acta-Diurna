/**
 * Ingestion error model: a parser/inspector throws a `ParseError` naming the
 * category of failure (encoding, format, size), and the service maps it to a
 * problem-details `AppError` (D9 / "no silent failure", FR12). Excel uploads
 * are not parsed at all - the package choice is parked (backlog "Excel parser
 * dependency choice") - so they get an honest `excelNotEnabled` AppError, not a
 * stub parser.
 */
import { AppError } from '$lib/server/problem';

export type ParseFailureKind = 'encoding' | 'format' | 'size';

/** A parse failure carrying which aspect failed, so the service can diagnose. */
export class ParseError extends Error {
	readonly kind: ParseFailureKind;

	constructor(message: string, kind: ParseFailureKind) {
		super(message);
		this.name = 'ParseError';
		this.kind = kind;
	}
}

/** 422 problem-details for a parse failure (encoding/format), never silent. */
export function unparseable(error: ParseError): AppError {
	return new AppError({
		status: 422,
		title: 'File could not be parsed',
		type: '/problems/unparseable-file',
		detail: error.message
	});
}

/** 413 problem-details for an over-cap upload, raised BEFORE the full parse. */
export function tooLarge(maxBytes: number): AppError {
	return new AppError({
		status: 413,
		title: 'Upload too large',
		type: '/problems/upload-too-large',
		detail: `File exceeds the ${Math.floor(maxBytes / 1_000_000)} MB upload limit.`
	});
}

/**
 * 422 problem-details for a stored data set that can no longer be read/parsed
 * (file corrupted on disk after a clean ingest). Distinct from `unparseable`:
 * the original upload was valid, so this is an integrity fault surfaced as a
 * problem-details rather than a 500. 2.5 auto-rebind re-reads on every refill,
 * so the failure must be a clean 422.
 */
export function dataSetUnreadable(): AppError {
	return new AppError({
		status: 422,
		title: 'Data set could not be read',
		type: '/problems/data-set-unreadable',
		detail: 'Stored data set could not be read.'
	});
}

/** 415 problem-details for an unsupported upload type. */
export function unsupportedFormat(detail: string): AppError {
	return new AppError({
		status: 415,
		title: 'Unsupported file type',
		type: '/problems/unsupported-format',
		detail
	});
}

/**
 * The honest Excel response (NOT a placeholder): Excel ingestion was named in
 * PRD FR12 but the product owner DECLINED it (2026-06-12, backlog "Excel parser
 * dependency choice") - a new parser dependency with a notable CVE surface for a
 * format CSV/JSON already cover. An `.xlsx`/`.xls` upload returns this real 415
 * pointing at the supported formats, never a fake parse.
 */
export function excelNotEnabled(): AppError {
	return new AppError({
		status: 415,
		title: 'Excel files not supported',
		type: '/problems/excel-not-enabled',
		detail: 'Excel is not supported. Upload a CSV or JSON file instead.'
	});
}
