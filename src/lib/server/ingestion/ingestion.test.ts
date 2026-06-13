import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { AppError } from '$lib/server/problem';
import { detectFormat, ingestBytes, ingestFile, MAX_UPLOAD_BYTES } from './ingestion.ts';

// One temp uploads dir for the whole file; the env mock points the service at
// it so writes land somewhere disposable, not the repo's data/uploads.
const uploadsDir = await mkdtemp(join(tmpdir(), 'acta-ingest-'));

vi.mock('$lib/server/env', () => ({
	serverEnv: () => ({ UPLOADS_DIR: uploadsDir })
}));

vi.mock('$lib/server/mode', () => ({
	operatingMode: () => 'single',
	isMultiAuthor: () => false
}));

// The ingestion service now validates a supplied reportId via the scoped getReport
// (story 8.2 IDOR fix): a foreign/unknown report id is the same 404, so the
// data set's report_id can never reference another author's report. The mock
// resolves a configured set of owned report ids and 404s everything else.
const ownedReportIds = vi.hoisted(() => ({ ids: new Set<string>() }));

vi.mock('$lib/server/documents/reports', () => ({
	getReport: (id: string) => {
		if (ownedReportIds.ids.has(id)) return Promise.resolve({ id });
		return Promise.reject(
			new AppError({ status: 404, title: 'Report not found', type: '/problems/report-not-found' })
		);
	}
}));

const TEST_SCOPE = { authorId: '01970000-0000-7000-8000-0000000000aa' };

const dbState = vi.hoisted(() => ({
	dataSets: new Map<string, Record<string, unknown>>()
}));

vi.mock('$lib/server/db/client', () => ({
	getDb: () => ({
		insert: (table: unknown) => ({
			values: (row: Record<string, unknown>) => {
				expect(getTableName(table as never)).toBe('data_sets');
				dbState.dataSets.set(String(row.id), row);
				return Promise.resolve();
			}
		})
	})
}));

function fileFrom(name: string, content: BlobPart, type = ''): File {
	return new File([content], name, { type });
}

async function expectAppError(promise: Promise<unknown>, status: number): Promise<AppError> {
	try {
		await promise;
	} catch (thrown) {
		expect(thrown).toBeInstanceOf(AppError);
		const error = thrown as AppError;
		expect(error.status).toBe(status);
		return error;
	}
	throw new Error(`expected an AppError with status ${status}`);
}

const OWNED_REPORT_ID = '01970000-0000-7000-8000-000000000001';

beforeEach(() => {
	dbState.dataSets.clear();
	// The report ids the happy-path tests target are owned by the pushing author.
	ownedReportIds.ids = new Set([OWNED_REPORT_ID]);
});

afterAll(async () => {
	await rm(uploadsDir, { recursive: true, force: true });
});

describe('detectFormat', () => {
	it('maps extensions and MIME types', () => {
		expect(detectFormat('data.csv', '')).toBe('csv');
		expect(detectFormat('data.json', '')).toBe('json');
		expect(detectFormat('book.xlsx', '')).toBe('xlsx');
		expect(detectFormat('book.xls', '')).toBe('xlsx');
		expect(detectFormat('noext', 'text/csv')).toBe('csv');
	});

	it('rejects an unsupported type with a 415', () => {
		try {
			detectFormat('image.png', 'image/png');
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(AppError);
			expect((thrown as AppError).status).toBe(415);
			return;
		}
		throw new Error('expected a 415');
	});
});

describe('ingestFile - CSV/JSON happy path', () => {
	it('parses, inspects, stores the file, and persists a row (CSV)', async () => {
		const dataSet = await ingestFile({
			file: fileFrom('weekly.csv', 'week,count\n2026-06-01,3\n2026-06-08,5'),
			scope: TEST_SCOPE
		});

		expect(dataSet.sourceFormat).toBe('csv');
		expect(dataSet.filename).toBe('weekly.csv');
		expect(dataSet.fields).toEqual([
			{ name: 'week', type: 'date' },
			{ name: 'count', type: 'number' }
		]);
		// Stored under a UUIDv7 name, NEVER the user filename (path traversal).
		expect(dataSet.storagePath).not.toContain('weekly.csv');
		expect(dataSet.storagePath).toContain(`${dataSet.id}.csv`);
		const written = await readFile(dataSet.storagePath, 'utf-8');
		expect(written).toContain('week,count');
		expect(dbState.dataSets.size).toBe(1);
	});

	it('parses an array-of-objects JSON', async () => {
		const dataSet = await ingestFile({
			file: fileFrom('rows.json', '[{"item":"a","n":1},{"item":"b","n":2}]'),
			scope: TEST_SCOPE
		});
		expect(dataSet.sourceFormat).toBe('json');
		expect(dataSet.fields).toEqual([
			{ name: 'item', type: 'string' },
			{ name: 'n', type: 'number' }
		]);
	});

	it('carries reportId and dataAsOf when provided (FR16 groundwork)', async () => {
		const asOf = new Date('2026-06-01T00:00:00Z');
		const dataSet = await ingestFile({
			file: fileFrom('d.csv', 'a\n1'),
			reportId: '01970000-0000-7000-8000-000000000001',
			dataAsOf: asOf,
			scope: TEST_SCOPE
		});
		expect(dataSet.reportId).toBe('01970000-0000-7000-8000-000000000001');
		expect(dataSet.dataAsOf).toEqual(asOf);
	});
});

describe('ingestBytes - the raw-body API entry (story 4.3)', () => {
	function bytesOf(text: string): Uint8Array {
		return new TextEncoder().encode(text);
	}

	it('runs the EXACT ingestFile pipeline: parses, inspects, stores, persists a row', async () => {
		const dataSet = await ingestBytes({
			bytes: bytesOf('week,count\n2026-06-01,3\n2026-06-08,5'),
			format: 'csv',
			filename: 'pushed.csv',
			reportId: '01970000-0000-7000-8000-000000000001',
			scope: TEST_SCOPE
		});

		expect(dataSet.sourceFormat).toBe('csv');
		expect(dataSet.filename).toBe('pushed.csv');
		expect(dataSet.reportId).toBe('01970000-0000-7000-8000-000000000001');
		expect(dataSet.fields).toEqual([
			{ name: 'week', type: 'date' },
			{ name: 'count', type: 'number' }
		]);
		// Stored under a UUIDv7 name, never the supplied filename (the 2.4 defence).
		expect(dataSet.storagePath).toContain(`${dataSet.id}.csv`);
		expect(dataSet.storagePath).not.toContain('pushed.csv');
		expect(dbState.dataSets.size).toBe(1);
	});

	it('parses JSON bytes', async () => {
		const dataSet = await ingestBytes({
			bytes: bytesOf('[{"item":"a","n":1}]'),
			format: 'json',
			filename: 'rows.json',
			scope: TEST_SCOPE
		});
		expect(dataSet.sourceFormat).toBe('json');
		expect(dataSet.fields).toEqual([
			{ name: 'item', type: 'string' },
			{ name: 'n', type: 'number' }
		]);
	});

	it('rejects an over-cap byte length with 413 before storing', async () => {
		const oversize = new Uint8Array(MAX_UPLOAD_BYTES + 1);
		const error = await expectAppError(
			ingestBytes({ bytes: oversize, format: 'csv', filename: 'big.csv', scope: TEST_SCOPE }),
			413
		);
		expect(error.type).toBe('/problems/upload-too-large');
		expect(dbState.dataSets.size).toBe(0);
	});

	it('surfaces the same 422 parse diagnostic as the upload flow', async () => {
		const error = await expectAppError(
			ingestBytes({
				bytes: bytesOf('a\n"oops'),
				format: 'csv',
				filename: 'broken.csv',
				scope: TEST_SCOPE
			}),
			422
		);
		expect(error.type).toBe('/problems/unparseable-file');
	});
});

describe('ingestFile - report ownership gate (story 8.2 IDOR fix)', () => {
	it('refuses a reportId the author does not own with the same 404 and stores nothing', async () => {
		const foreignReportId = '01970000-0000-7000-8000-0000000000b1';
		const error = await expectAppError(
			ingestFile({
				file: fileFrom('d.csv', 'a\n1'),
				reportId: foreignReportId,
				scope: TEST_SCOPE
			}),
			404
		);
		expect(error.type).toBe('/problems/report-not-found');
		// No row stamped with a cross-author report id (the data set is never written).
		expect(dbState.dataSets.size).toBe(0);
	});

	it('refuses an unknown reportId on the raw-bytes push the same way', async () => {
		await expectAppError(
			ingestBytes({
				bytes: new TextEncoder().encode('a\n1'),
				format: 'csv',
				filename: 'd.csv',
				reportId: '01970000-0000-7000-8000-00000000dead',
				scope: TEST_SCOPE
			}),
			404
		);
		expect(dbState.dataSets.size).toBe(0);
	});

	it('stores an unbound data set (no reportId) without any ownership check', async () => {
		const dataSet = await ingestFile({ file: fileFrom('d.csv', 'a\n1'), scope: TEST_SCOPE });
		expect(dataSet.reportId).toBeNull();
		expect(dbState.dataSets.size).toBe(1);
	});
});

describe('ingestFile - Excel is parked (honest error)', () => {
	it('returns 415 /problems/excel-not-enabled for an .xlsx upload, never a stub parse', async () => {
		const error = await expectAppError(
			ingestFile({ file: fileFrom('book.xlsx', 'PK binary'), scope: TEST_SCOPE }),
			415
		);
		expect(error.type).toBe('/problems/excel-not-enabled');
		expect(error.detail).toBe('Excel is not supported. Upload a CSV or JSON file instead.');
		// Nothing was stored: Excel is declined, so no row is written.
		expect(dbState.dataSets.size).toBe(0);
	});
});

describe('ingestFile - size cap (NFR4, before parse)', () => {
	it('rejects an over-cap file with 413 before reading it', async () => {
		const oversize = { name: 'big.csv', type: '', size: MAX_UPLOAD_BYTES + 1 } as File;
		const error = await expectAppError(ingestFile({ file: oversize, scope: TEST_SCOPE }), 413);
		expect(error.type).toBe('/problems/upload-too-large');
		expect(dbState.dataSets.size).toBe(0);
	});
});

describe('ingestFile - diagnostics (never silent)', () => {
	it('returns 422 for invalid UTF-8 (encoding diagnostic)', async () => {
		// A lone 0xFF byte is not valid UTF-8.
		const error = await expectAppError(
			ingestFile({
				file: fileFrom('bad.csv', new Uint8Array([0xff, 0xfe, 0x00])),
				scope: TEST_SCOPE
			}),
			422
		);
		expect(error.detail).toContain('UTF-8');
		expect(dbState.dataSets.size).toBe(0);
	});

	it('returns 422 for a malformed CSV (unterminated quote)', async () => {
		const error = await expectAppError(
			ingestFile({ file: fileFrom('broken.csv', 'a\n"oops'), scope: TEST_SCOPE }),
			422
		);
		expect(error.type).toBe('/problems/unparseable-file');
		expect(dbState.dataSets.size).toBe(0);
	});

	it('returns 422 for non-tabular JSON', async () => {
		const error = await expectAppError(
			ingestFile({ file: fileFrom('obj.json', '{"a":1}'), scope: TEST_SCOPE }),
			422
		);
		expect(error.type).toBe('/problems/unparseable-file');
	});
});
