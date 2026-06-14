/**
 * Ingestion service (FR12, NFR4): accept an uploaded data file, enforce the
 * 50 MB cap BEFORE buffering/parsing the whole thing, parse CSV or JSON into a
 * tabular shape, inspect its columns, store the bytes on the uploads volume
 * under a UUIDv7 name (never the user filename - path traversal), and persist a
 * `data_sets` metadata row. Excel uploads are not parsed: the parser package is
 * parked (backlog "Excel parser dependency choice"), so they get an honest 415.
 *
 * Only this domain touches the uploads volume and the `data_sets` table (the
 * data-boundary rule, architecture). Parse failures surface as problem-details
 * AppError; nothing fails silently.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ownerForInsert, type AuthorScope } from '$lib/server/authors';
import { getDb } from '$lib/server/db/client';
import { uuidv7 } from '$lib/server/db/ids';
import { dataSets, type DataSetField, type DataSetRow } from '$lib/server/db/schema';
import { getReport } from '$lib/server/documents/reports';
import { serverEnv } from '$lib/server/env';
import { AppError } from '$lib/server/problem';
import { parseCsv } from './csv.ts';
import { excelNotEnabled, ParseError, tooLarge, unparseable, unsupportedFormat } from './errors.ts';
import { inspectFields } from './inspect.ts';
import { parseJson } from './json.ts';

/** Hard upload cap (NFR4): 50 MB, checked before the file is buffered/parsed. */
export const MAX_UPLOAD_BYTES = 50_000_000;

export type SourceFormat = 'csv' | 'json' | 'xlsx';

export interface DataSet {
	id: string;
	reportId: string | null;
	filename: string;
	sourceFormat: SourceFormat;
	fields: DataSetField[];
	injectedAt: Date;
	dataAsOf: Date | null;
	storagePath: string;
}

/** A parsed-but-not-yet-stored table: columns + keyed rows for the resolver. */
export interface ParsedTable {
	columns: string[];
	rows: Record<string, unknown>[];
}

/**
 * The FR16 data-freshness instant for a data set (Story 6.4): the explicit
 * `data_as_of` when the upload carried one, otherwise the injection time. Both
 * are always present in practice (`injected_at` is NOT NULL), so a bound data set
 * always yields a usable timestamp - the "no usable timestamp" case is a binding
 * with NO data set, handled where the binding is stamped. Returned as an ISO-8601
 * string so it bakes straight onto the binding the pure renderer reads.
 */
export function resolveDataAsOf(dataSet: DataSet): string {
	return (dataSet.dataAsOf ?? dataSet.injectedAt).toISOString();
}

/** Maps a stored `data_sets` row to the service `DataSet` shape. Shared by the
 *  write side (here) and the read queries (`queries.ts`). */
export function toDataSet(row: DataSetRow): DataSet {
	return {
		id: row.id,
		reportId: row.reportId ?? null,
		filename: row.filename,
		sourceFormat: row.sourceFormat as SourceFormat,
		fields: row.fields,
		injectedAt: row.injectedAt,
		dataAsOf: row.dataAsOf ?? null,
		storagePath: row.storagePath
	};
}

/**
 * Decides the source format from the upload's name and declared MIME type. An
 * Excel extension or spreadsheet MIME maps to `xlsx` (rejected downstream with
 * the honest 415); CSV and JSON are parsed. Anything else is unsupported.
 */
export function detectFormat(filename: string, mimeType: string): SourceFormat {
	const lower = filename.toLowerCase();
	if (lower.endsWith('.csv')) return 'csv';
	if (lower.endsWith('.json')) return 'json';
	if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'xlsx';

	if (mimeType === 'text/csv') return 'csv';
	if (mimeType === 'application/json') return 'json';
	if (
		mimeType === 'application/vnd.ms-excel' ||
		mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	) {
		return 'xlsx';
	}
	throw unsupportedFormat(`Unsupported file type "${filename}". Upload a .csv or .json file.`);
}

/** Decodes upload bytes as UTF-8, rejecting invalid sequences (encoding diagnostic). */
function decodeUtf8(bytes: Uint8Array): string {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		throw new AppError({
			status: 422,
			title: 'File could not be parsed',
			type: '/problems/unparseable-file',
			detail: 'File is not valid UTF-8 text. Re-export it as UTF-8.'
		});
	}
}

function parseByFormat(format: SourceFormat, text: string): ParsedTable {
	try {
		return format === 'csv' ? parseCsv(text) : parseJson(text);
	} catch (error) {
		if (error instanceof ParseError) throw unparseable(error);
		throw error;
	}
}

export interface IngestInput {
	file: File;
	/** The author the new data set belongs to (story 8.2): stamped as `owner_id`. */
	scope: AuthorScope;
	reportId?: string | null;
	/** FR16 groundwork: the "as of" date of the data; rendered in Epic 6. */
	dataAsOf?: Date | null;
}

/**
 * Raw-bytes ingestion entry (story 4.3): the API push delivers the file as the
 * request body with the format declared by `Content-Type`, not as a multipart
 * `File`. This wraps the bytes in a `File` and delegates to `ingestFile` so the
 * push runs the EXACT upload pipeline - same cap, same parser, same UUIDv7
 * storage, same `data_sets` row - just a different transport. The size cap is
 * re-checked on the buffered length here too (the endpoint already rejected an
 * over-cap `Content-Length` before reading), keeping the 413 honest if a
 * transport under-reports the length.
 */
export interface IngestBytesInput {
	bytes: Uint8Array;
	format: SourceFormat;
	filename: string;
	/** The author the new data set belongs to (story 8.2): stamped as `owner_id`. */
	scope: AuthorScope;
	reportId?: string | null;
	dataAsOf?: Date | null;
}

export async function ingestBytes(input: IngestBytesInput): Promise<DataSet> {
	const { bytes, format, filename, scope, reportId = null, dataAsOf = null } = input;
	if (bytes.byteLength > MAX_UPLOAD_BYTES) {
		throw tooLarge(MAX_UPLOAD_BYTES);
	}
	const mimeType = format === 'csv' ? 'text/csv' : format === 'json' ? 'application/json' : '';
	// Copy into a fresh ArrayBuffer: a plain Uint8Array's backing buffer is typed
	// ArrayBufferLike (it could be a SharedArrayBuffer), which is not a BlobPart
	// under strict lib types. The slice is a one-time copy at the API boundary.
	const buffer = bytes.slice().buffer;
	const file = new File([buffer], filename, { type: mimeType });
	return ingestFile({ file, scope, reportId, dataAsOf });
}

/**
 * Ingests one uploaded file end to end. The size cap is checked on `file.size`
 * (the multipart length) BEFORE `arrayBuffer()` buffers the bytes, so an
 * oversized upload is rejected with 413 without spending memory on it. Excel is
 * rejected with the honest 415 before any read.
 */
export async function ingestFile(input: IngestInput): Promise<DataSet> {
	const { file, scope, reportId = null, dataAsOf = null } = input;

	if (file.size > MAX_UPLOAD_BYTES) {
		throw tooLarge(MAX_UPLOAD_BYTES);
	}

	const format = detectFormat(file.name, file.type);
	if (format === 'xlsx') {
		throw excelNotEnabled();
	}

	// Validate the target report is owned by the pushing author BEFORE stamping it
	// on the data set (story 8.2 IDOR fix). A foreign/unknown report id is the same
	// 404 the scoped `getReport` raises - the gate `rebindReport` already applies on
	// the push - so a `data_sets.report_id` can never reference another author's
	// report. In single mode the scope is the implicit author, so the check passes
	// for every existing report exactly as before.
	if (reportId !== null) {
		await getReport(reportId, scope);
	}

	const bytes = new Uint8Array(await file.arrayBuffer());
	// Re-check after buffering: file.size is the declared multipart length; the
	// actual byte count is authoritative and never larger in practice, but the
	// guard keeps the cap honest if a transport ever under-reports size.
	if (bytes.byteLength > MAX_UPLOAD_BYTES) {
		throw tooLarge(MAX_UPLOAD_BYTES);
	}

	const text = decodeUtf8(bytes);
	const table = parseByFormat(format, text);
	const fields = inspectFields(table.columns, table.rows);

	const id = uuidv7();
	const uploadsDir = serverEnv().UPLOADS_DIR;
	const storedName = `${id}.${format}`;
	const storagePath = join(uploadsDir, storedName);
	await mkdir(uploadsDir, { recursive: true });
	await writeFile(storagePath, bytes);

	const now = new Date();
	const row: DataSetRow = {
		id,
		reportId,
		filename: file.name,
		sourceFormat: format,
		fields,
		injectedAt: now,
		dataAsOf,
		storagePath,
		ownerId: ownerForInsert(scope)
	};
	await getDb().insert(dataSets).values(row);
	return toDataSet(row);
}
