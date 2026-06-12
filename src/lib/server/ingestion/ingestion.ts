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
import { getDb } from '$lib/server/db/client';
import { uuidv7 } from '$lib/server/db/ids';
import { dataSets, type DataSetField, type DataSetRow } from '$lib/server/db/schema';
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
	reportId?: string | null;
	/** FR16 groundwork: the "as of" date of the data; rendered in Epic 6. */
	dataAsOf?: Date | null;
}

/**
 * Ingests one uploaded file end to end. The size cap is checked on `file.size`
 * (the multipart length) BEFORE `arrayBuffer()` buffers the bytes, so an
 * oversized upload is rejected with 413 without spending memory on it. Excel is
 * rejected with the honest 415 before any read.
 */
export async function ingestFile(input: IngestInput): Promise<DataSet> {
	const { file, reportId = null, dataAsOf = null } = input;

	if (file.size > MAX_UPLOAD_BYTES) {
		throw tooLarge(MAX_UPLOAD_BYTES);
	}

	const format = detectFormat(file.name, file.type);
	if (format === 'xlsx') {
		throw excelNotEnabled();
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
		storagePath
	};
	await getDb().insert(dataSets).values(row);
	return toDataSet(row);
}
