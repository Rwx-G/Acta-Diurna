import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Column, getTableName, Param, type SQL } from 'drizzle-orm';
import { AppError } from '$lib/server/problem';
import { __clearParsedTableCache, bindBlock, listDataSets, readDataSetTable } from './queries.ts';

// Wrap `readFile` in a spy that delegates to the real implementation, so the
// cache test can count disk reads while the rest of the suite reads real files.
// Other fs/promises members are passed through untouched (the setup writes files).
vi.mock('node:fs/promises', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs/promises')>();
	return { ...actual, readFile: vi.fn(actual.readFile) };
});

vi.mock('$lib/server/mode', () => ({
	operatingMode: () => 'single',
	isMultiAuthor: () => false
}));

const TEST_SCOPE = { authorId: '01970000-0000-7000-8000-0000000000aa' };

const readFileMock = vi.mocked(readFile);

const uploadsDir = await mkdtemp(join(tmpdir(), 'acta-queries-'));

const dbState = vi.hoisted(() => ({
	data_sets: new Map<string, Record<string, unknown>>(),
	reports: new Map<string, Record<string, unknown>>(),
	listProjections: [] as (string[] | undefined)[],
	listLimits: [] as number[]
}));

function storeFor(name: string): Map<string, Record<string, unknown>> {
	return name === 'reports' ? dbState.reports : dbState.data_sets;
}

/** Column names of a drizzle `.select({...})` projection, or undefined for a bare select. */
function decodeSelectProjection(projection: unknown): string[] | undefined {
	if (projection === undefined) return undefined;
	return Object.values(projection as Record<string, unknown>).map((column) =>
		column instanceof Column ? column.name : String(column)
	);
}

function decodeEqFilter(filter: unknown): { column: string; value: unknown } {
	const chunks = (filter as { queryChunks: unknown[] }).queryChunks;
	const column = chunks.find((chunk): chunk is Column => chunk instanceof Column);
	const param = chunks.find((chunk): chunk is Param => chunk instanceof Param);
	if (!column || !param) throw new Error('mock only supports eq(column, value)');
	return { column: column.name, value: param.value };
}

vi.mock('$lib/server/db/client', () => ({
	getDb: () => ({
		select: (projection?: unknown) => ({
			from: (table: unknown) => {
				const store = storeFor(getTableName(table as never));
				return {
					where: (filter: SQL) => {
						const decoded = decodeEqFilter(filter);
						return {
							limit: () => {
								const row = store.get(String(decoded.value));
								return Promise.resolve(row ? [row] : []);
							}
						};
					},
					// listDataSets calls select(projection).from().orderBy().limit() with
					// no where: all rows in the store, ordered (insertion order here), capped.
					orderBy: () => {
						dbState.listProjections.push(decodeSelectProjection(projection));
						const rows = [...store.values()];
						return {
							limit: (count: number) => {
								dbState.listLimits.push(count);
								return Promise.resolve(rows.slice(0, count));
							}
						};
					}
				};
			}
		}),
		update: (table: unknown) => {
			const store = storeFor(getTableName(table as never));
			return {
				set: (values: Record<string, unknown>) => ({
					where: (filter: SQL) => {
						const decoded = decodeEqFilter(filter);
						const existing = store.get(String(decoded.value));
						if (existing) store.set(String(decoded.value), { ...existing, ...values });
						return Promise.resolve({ rowCount: existing ? 1 : 0 });
					}
				})
			};
		}
	})
}));

const REPORT_ID = '01970000-0000-7000-8000-0000000000aa';
const DATA_SET_ID = '01970000-0000-7000-8000-0000000000bb';

function seedReport(): void {
	const now = new Date();
	dbState.reports.set(REPORT_ID, {
		id: REPORT_ID,
		title: 'Weekly',
		status: 'draft',
		schemaVersion: 1,
		document: {
			version: 1,
			title: 'Weekly',
			sections: [
				{
					id: 'metrics',
					title: 'Metrics',
					blocks: [
						{
							type: 'table',
							id: 'weekly-table',
							columns: [{ key: 'placeholder', label: 'Placeholder' }],
							binding: { fields: [{ name: 'week', type: 'date' }] }
						}
					]
				}
			]
		},
		publishedDocument: null,
		publishedAt: null,
		createdAt: now,
		updatedAt: now
	});
}

async function seedDataSet(): Promise<void> {
	const storagePath = join(uploadsDir, `${DATA_SET_ID}.csv`);
	await writeFile(storagePath, 'week,count\n2026-06-01,3\n2026-06-08,5');
	dbState.data_sets.set(DATA_SET_ID, {
		id: DATA_SET_ID,
		reportId: null,
		filename: 'weekly.csv',
		sourceFormat: 'csv',
		fields: [
			{ name: 'week', type: 'date' },
			{ name: 'count', type: 'number' }
		],
		injectedAt: new Date(),
		dataAsOf: null,
		storagePath
	});
}

beforeEach(async () => {
	dbState.reports.clear();
	dbState.data_sets.clear();
	dbState.listProjections = [];
	dbState.listLimits = [];
	// A data set is immutable in production, so the parsed-table cache never goes
	// stale; the tests rewrite the stored file under a reused id, so clear it to
	// force a fresh read per test.
	__clearParsedTableCache();
	readFileMock.mockClear();
	seedReport();
	await seedDataSet();
});

afterAll(async () => {
	await rm(uploadsDir, { recursive: true, force: true });
});

describe('bindBlock', () => {
	it('binds a data set onto a block and persists the binding + resolved data in the document', async () => {
		const report = await bindBlock(
			REPORT_ID,
			'weekly-table',
			DATA_SET_ID,
			{
				week: { role: 'column' },
				count: { role: 'column' }
			},
			TEST_SCOPE
		);

		const block = report.document.sections[0].blocks[0];
		if (block.type !== 'table') throw new Error('expected a table block');
		// Resolved data is present.
		expect(block.columns.map((c) => c.key)).toEqual(['week', 'count']);
		expect(block.rows).toHaveLength(2);
		// Binding persisted with dataSetId and slots.
		expect(block.binding?.dataSetId).toBe(DATA_SET_ID);
		expect(block.binding?.fields[0].slot?.role).toBe('column');
		// The stored row reflects the write.
		const stored = dbState.reports.get(REPORT_ID);
		expect(stored?.document).toEqual(report.document);
	});

	it('throws 404 when the block id is not in the report', async () => {
		try {
			await bindBlock(
				REPORT_ID,
				'no-such-block',
				DATA_SET_ID,
				{ week: { role: 'column' } },
				TEST_SCOPE
			);
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(AppError);
			expect((thrown as AppError).status).toBe(404);
			expect((thrown as AppError).type).toBe('/problems/block-not-found');
			return;
		}
		throw new Error('expected a 404');
	});

	it('throws 422 when the slot mapping is incoherent for the block type', async () => {
		// A table block with no column slot -> resolver throws -> 422.
		try {
			await bindBlock(REPORT_ID, 'weekly-table', DATA_SET_ID, { week: { role: 'x' } }, TEST_SCOPE);
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(AppError);
			expect((thrown as AppError).status).toBe(422);
			return;
		}
		throw new Error('expected a 422');
	});
});

describe('listDataSets', () => {
	it('projects only the summary columns, never storage_path or data_as_of', async () => {
		await listDataSets(TEST_SCOPE);

		expect(dbState.listProjections).toHaveLength(1);
		expect(dbState.listProjections[0]).toEqual([
			'id',
			'report_id',
			'filename',
			'source_format',
			'fields',
			'injected_at'
		]);
		expect(dbState.listProjections[0]).not.toContain('storage_path');
		expect(dbState.listProjections[0]).not.toContain('data_as_of');
	});

	it('maps the projected rows to the summary shape', async () => {
		const summaries = await listDataSets(TEST_SCOPE);

		expect(summaries).toHaveLength(1);
		expect(summaries[0]).toEqual({
			id: DATA_SET_ID,
			reportId: null,
			filename: 'weekly.csv',
			sourceFormat: 'csv',
			fields: [
				{ name: 'week', type: 'date' },
				{ name: 'count', type: 'number' }
			],
			injectedAt: expect.any(Date)
		});
		expect(summaries[0]).not.toHaveProperty('storagePath');
		expect(summaries[0]).not.toHaveProperty('dataAsOf');
	});

	it('caps the query with a LIMIT ceiling so the list cannot scan unboundedly', async () => {
		await listDataSets(TEST_SCOPE);

		expect(dbState.listLimits).toEqual([500]);
	});
});

describe('readDataSetTable', () => {
	it('maps a corrupted stored file to a 422 problem-details, not a 500', async () => {
		// The file was valid at ingest; corrupt it on disk (unterminated quote) so
		// the re-parse fails. bindBlock awaits this BEFORE its try block, so it must
		// surface as problem-details, never a raw ParseError -> 500.
		const storagePath = join(uploadsDir, `${DATA_SET_ID}.csv`);
		await writeFile(storagePath, 'week,count\n"oops');

		try {
			await readDataSetTable(DATA_SET_ID, TEST_SCOPE);
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(AppError);
			expect((thrown as AppError).status).toBe(422);
			expect((thrown as AppError).type).toBe('/problems/data-set-unreadable');
			return;
		}
		throw new Error('expected a 422');
	});

	it('caps materialized rows and rejects an over-cap data set with 422', async () => {
		// 10001 rows exceeds the 10000-row binding cap: fail fast with a clear 422
		// rather than building a giant array a downstream validator would reject.
		const storagePath = join(uploadsDir, `${DATA_SET_ID}.csv`);
		const lines = ['week,count'];
		for (let i = 0; i < 10001; i++) lines.push(`2026-06-01,${i}`);
		await writeFile(storagePath, lines.join('\n'));

		try {
			await readDataSetTable(DATA_SET_ID, TEST_SCOPE);
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(AppError);
			expect((thrown as AppError).status).toBe(422);
			expect((thrown as AppError).detail).toContain('10000 rows');
			return;
		}
		throw new Error('expected a 422');
	});

	it('reads and parses the file once, then serves the second call from cache', async () => {
		const first = await readDataSetTable(DATA_SET_ID, TEST_SCOPE);
		const second = await readDataSetTable(DATA_SET_ID, TEST_SCOPE);

		// A data set is immutable, so the second call must NOT re-read the file: the
		// disk read and re-parse happen exactly once across the two calls.
		expect(readFileMock).toHaveBeenCalledTimes(1);
		expect(second).toBe(first);
		expect(first.rows).toHaveLength(2);
	});

	it('does not cache an over-cap data set (the next read still hits disk)', async () => {
		const storagePath = join(uploadsDir, `${DATA_SET_ID}.csv`);
		const lines = ['week,count'];
		for (let i = 0; i < 10001; i++) lines.push(`2026-06-01,${i}`);
		await writeFile(storagePath, lines.join('\n'));

		await expect(readDataSetTable(DATA_SET_ID, TEST_SCOPE)).rejects.toBeInstanceOf(AppError);

		// Shrink the file back under the cap; a fresh read must succeed (the failed
		// over-cap read left nothing poisoning the cache).
		await writeFile(storagePath, 'week,count\n2026-06-01,3');
		const table = await readDataSetTable(DATA_SET_ID, TEST_SCOPE);
		expect(table.rows).toHaveLength(1);
	});
});
