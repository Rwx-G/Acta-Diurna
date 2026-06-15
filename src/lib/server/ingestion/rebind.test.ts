import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Column, getTableName, Param, type SQL } from 'drizzle-orm';
import { AppError } from '$lib/server/problem';
import { __clearParsedTableCache } from './queries.ts';
import { rebindReport, remapField } from './rebind.ts';

vi.mock('$lib/server/mode', () => ({
	operatingMode: () => 'single',
	isMultiAuthor: () => false
}));

const TEST_SCOPE = { authorId: '01970000-0000-7000-8000-0000000000aa' };

const uploadsDir = await mkdtemp(join(tmpdir(), 'acta-rebind-'));

const dbState = vi.hoisted(() => ({
	data_sets: new Map<string, Record<string, unknown>>(),
	reports: new Map<string, Record<string, unknown>>(),
	// When armed, a single reports read bumps the stored `updated_at` right after
	// returning the row, simulating a concurrent producer write that lands between an
	// action's read and its write. The optimistic-concurrency WHERE then misses.
	bumpReportTokenAfterNextRead: false
}));

function storeFor(name: string): Map<string, Record<string, unknown>> {
	return name === 'reports' ? dbState.reports : dbState.data_sets;
}

function decodeEqFilter(filter: unknown): { column: string; value: unknown } {
	const chunks = (filter as { queryChunks: unknown[] }).queryChunks;
	const column = chunks.find((chunk): chunk is Column => chunk instanceof Column);
	const param = chunks.find((chunk): chunk is Param => chunk instanceof Param);
	if (!column || !param) throw new Error('mock only supports eq(column, value)');
	return { column: column.name, value: param.value };
}

/**
 * Decodes an optimistic-concurrency WHERE - `eq(id)` or `and(eq(id), eq(updated_at))`
 * - into the id and the optional expected `updated_at`. A drizzle `and(...)` nests
 * each `eq` as its own SQL node a few levels deep, so this flattens the whole tree in
 * traversal order, pairing each Column with the next Param. Mirrors how
 * `updateReportDocument` builds the WHERE when a caller threads `expectedUpdatedAt`.
 */
function decodeUpdateWhere(filter: unknown): { id: unknown; expectedUpdatedAt?: unknown } {
	const columns: string[] = [];
	const params: unknown[] = [];
	const walk = (node: unknown): void => {
		if (node instanceof Column) columns.push(node.name);
		else if (node instanceof Param) params.push(node.value);
		const chunks = (node as { queryChunks?: unknown[] })?.queryChunks;
		if (Array.isArray(chunks)) for (const chunk of chunks) walk(chunk);
	};
	walk(filter);
	const byColumn = new Map(columns.map((name, index) => [name, params[index]]));
	return { id: byColumn.get('id'), expectedUpdatedAt: byColumn.get('updated_at') };
}

vi.mock('$lib/server/db/client', () => ({
	getDb: () => ({
		select: () => ({
			from: (table: unknown) => {
				const store = storeFor(getTableName(table as never));
				return {
					where: (filter: SQL) => {
						const decoded = decodeEqFilter(filter);
						return {
							limit: () => {
								const row = store.get(String(decoded.value));
								// Simulate a concurrent producer write landing between this read and
								// the action's later write: hand back the row the action loads, then
								// advance the stored token so the optimistic-concurrency WHERE misses.
								if (row && store === dbState.reports && dbState.bumpReportTokenAfterNextRead) {
									dbState.bumpReportTokenAfterNextRead = false;
									const snapshot = { ...row };
									store.set(String(decoded.value), {
										...row,
										updatedAt: new Date((row.updatedAt as Date).getTime() + 1000)
									});
									return Promise.resolve([snapshot]);
								}
								return Promise.resolve(row ? [row] : []);
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
						const decoded = decodeUpdateWhere(filter);
						const existing = store.get(String(decoded.id));
						// Optimistic concurrency: when the WHERE pins `updated_at`, a row whose
						// stored token has moved on does not match - zero rows, which the service
						// maps to a 409 conflict, exactly as Postgres would.
						const matches =
							existing !== undefined &&
							(decoded.expectedUpdatedAt === undefined ||
								(existing.updatedAt as Date).getTime() ===
									(decoded.expectedUpdatedAt as Date).getTime());
						if (matches) store.set(String(decoded.id), { ...existing, ...values });
						return Promise.resolve({ rowCount: matches ? 1 : 0 });
					}
				})
			};
		}
	})
}));

const REPORT_ID = '01970000-0000-7000-8000-0000000000aa';
const DATA_SET_ID = '01970000-0000-7000-8000-0000000000bb';

/** A draft report with one bound table block (severity + count, both columns). */
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
							id: 'severity-table',
							columns: [
								{ key: 'severity', label: 'severity' },
								{ key: 'count', label: 'count' }
							],
							rows: [{ severity: 'Critical', count: 1 }],
							binding: {
								dataSetId: 'ds-old',
								fields: [
									{ name: 'severity', type: 'string', slot: { role: 'column' } },
									{ name: 'count', type: 'number', slot: { role: 'column' } }
								]
							}
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

async function seedDataSet(csv: string, fields: { name: string; type: string }[]): Promise<void> {
	const storagePath = join(uploadsDir, `${DATA_SET_ID}.csv`);
	await writeFile(storagePath, csv);
	dbState.data_sets.set(DATA_SET_ID, {
		id: DATA_SET_ID,
		reportId: null,
		filename: 'fresh.csv',
		sourceFormat: 'csv',
		fields,
		injectedAt: new Date(),
		dataAsOf: null,
		storagePath
	});
}

beforeEach(() => {
	dbState.reports.clear();
	dbState.data_sets.clear();
	dbState.bumpReportTokenAfterNextRead = false;
	// Each test reseeds the same data-set id with different CSV under the same
	// stored path; clear the immutable-table cache so a test reads its own file.
	__clearParsedTableCache();
	seedReport();
});

afterAll(async () => {
	await rm(uploadsDir, { recursive: true, force: true });
});

describe('rebindReport (FR14)', () => {
	it('rebinds every matching block with the fresh data, no manual mapping', async () => {
		await seedDataSet('severity,count\nCritical,4\nHigh,9', [
			{ name: 'severity', type: 'string' },
			{ name: 'count', type: 'number' }
		]);

		const result = await rebindReport(REPORT_ID, DATA_SET_ID, TEST_SCOPE);

		expect(result.rebound).toEqual(['severity-table']);
		expect(result.summary).toEqual({
			total: 1,
			bound: 1,
			drifted: 0,
			unresolved: 0,
			allGreen: true
		});
		const block = result.report.document.sections[0].blocks[0];
		if (block.type !== 'table') throw new Error('expected a table block');
		// Fresh rows landed and the binding now points at the new data set.
		expect(block.rows).toHaveLength(2);
		// CSV cells are stored as their raw string form by the table resolver.
		expect(block.rows?.[0]).toMatchObject({ severity: 'Critical', count: '4' });
		expect(block.binding?.dataSetId).toBe(DATA_SET_ID);
	});

	it('flags a renamed field as drifted (amber) and leaves the block untouched', async () => {
		// "count" renamed to "counts": the block cannot rebind cleanly -> amber.
		await seedDataSet('severity,counts\nCritical,4', [
			{ name: 'severity', type: 'string' },
			{ name: 'counts', type: 'number' }
		]);

		const result = await rebindReport(REPORT_ID, DATA_SET_ID, TEST_SCOPE);

		expect(result.rebound).toEqual([]);
		expect(result.summary.drifted).toBe(1);
		const diagnostic = result.diagnostics[0];
		expect(diagnostic.state).toBe('drifted');
		expect(diagnostic.drifts).toEqual([{ expected: 'count', closest: 'counts', distance: 1 }]);
		// The block kept its last-good data (not re-resolved).
		const block = result.report.document.sections[0].blocks[0];
		if (block.type !== 'table') throw new Error('expected a table block');
		expect(block.rows).toEqual([{ severity: 'Critical', count: 1 }]);
	});

	it('flags an entirely foreign data set as unresolved (red)', async () => {
		await seedDataSet('alpha,beta\n1,2', [
			{ name: 'alpha', type: 'number' },
			{ name: 'beta', type: 'number' }
		]);

		const result = await rebindReport(REPORT_ID, DATA_SET_ID, TEST_SCOPE);

		expect(result.rebound).toEqual([]);
		expect(result.summary.unresolved).toBe(1);
		expect(result.diagnostics[0].state).toBe('unresolved');
	});

	it('409s with report-conflict when a concurrent write lands between the read and the rebind write', async () => {
		await seedDataSet('severity,count\nCritical,4\nHigh,9', [
			{ name: 'severity', type: 'string' },
			{ name: 'count', type: 'number' }
		]);
		// A concurrent producer write bumps the stored token between this action's read
		// and its write. The rebind threads the loaded token into the write, so the
		// stale write must 409 instead of silently stomping the concurrent edit.
		dbState.bumpReportTokenAfterNextRead = true;

		await expect(rebindReport(REPORT_ID, DATA_SET_ID, TEST_SCOPE)).rejects.toMatchObject({
			status: 409,
			type: '/problems/report-conflict'
		});
	});
});

describe('remapField (FR15)', () => {
	it('remaps an expected field onto an available field, persists, and re-resolves', async () => {
		await seedDataSet('severity,counts\nCritical,4\nHigh,9', [
			{ name: 'severity', type: 'string' },
			{ name: 'counts', type: 'number' }
		]);

		const report = await remapField(
			REPORT_ID,
			'severity-table',
			DATA_SET_ID,
			'count',
			'counts',
			TEST_SCOPE
		);

		const block = report.document.sections[0].blocks[0];
		if (block.type !== 'table') throw new Error('expected a table block');
		// The binding now references "counts" (the remap persisted), keeping the
		// column slot, and the fresh rows resolved.
		const names = block.binding?.fields.map((field) => field.name);
		expect(names).toEqual(['severity', 'counts']);
		expect(block.binding?.fields[1].slot?.role).toBe('column');
		expect(block.rows).toHaveLength(2);
		expect(block.rows?.[0]).toMatchObject({ counts: '4' });
		// Persisted to the store.
		const stored = dbState.reports.get(REPORT_ID) as { document: typeof report.document };
		expect(stored.document).toEqual(report.document);
	});

	it('throws 404 when the expected field is not a bound field on the block', async () => {
		await seedDataSet('severity,counts\nCritical,4', [
			{ name: 'severity', type: 'string' },
			{ name: 'counts', type: 'number' }
		]);

		await expect(
			remapField(REPORT_ID, 'severity-table', DATA_SET_ID, 'nonexistent', 'counts', TEST_SCOPE)
		).rejects.toMatchObject({ status: 404, type: '/problems/binding-field-not-found' });
	});

	it('throws 404 when the block id is not in the report', async () => {
		await seedDataSet('severity,counts\nCritical,4', [
			{ name: 'severity', type: 'string' },
			{ name: 'counts', type: 'number' }
		]);

		await expect(
			remapField(REPORT_ID, 'no-such-block', DATA_SET_ID, 'count', 'counts', TEST_SCOPE)
		).rejects.toBeInstanceOf(AppError);
	});

	it('throws 404 and persists nothing when the target field is absent from the data set', async () => {
		await seedDataSet('severity,counts\nCritical,4', [
			{ name: 'severity', type: 'string' },
			{ name: 'counts', type: 'number' }
		]);
		const before = structuredClone(dbState.reports.get(REPORT_ID)!.document);

		await expect(
			remapField(REPORT_ID, 'severity-table', DATA_SET_ID, 'count', 'phantom', TEST_SCOPE)
		).rejects.toMatchObject({ status: 404, type: '/problems/binding-field-not-found' });

		// The binding is unchanged and nothing was written.
		expect(dbState.reports.get(REPORT_ID)!.document).toEqual(before);
	});

	it('throws 409 and persists nothing when the target collides with another bound field', async () => {
		await seedDataSet('severity,count\nCritical,4', [
			{ name: 'severity', type: 'string' },
			{ name: 'count', type: 'number' }
		]);
		const before = structuredClone(dbState.reports.get(REPORT_ID)!.document);

		// "count" is remapped onto "severity", which already carries a column slot.
		await expect(
			remapField(REPORT_ID, 'severity-table', DATA_SET_ID, 'count', 'severity', TEST_SCOPE)
		).rejects.toMatchObject({ status: 409, type: '/problems/field-already-bound' });

		expect(dbState.reports.get(REPORT_ID)!.document).toEqual(before);
	});

	it('409s with report-conflict when a concurrent write lands between the read and the remap write', async () => {
		await seedDataSet('severity,counts\nCritical,4\nHigh,9', [
			{ name: 'severity', type: 'string' },
			{ name: 'counts', type: 'number' }
		]);
		// A concurrent producer write bumps the stored token between the read and the
		// remap write; the threaded token makes the stale write 409 rather than stomp it.
		dbState.bumpReportTokenAfterNextRead = true;

		await expect(
			remapField(REPORT_ID, 'severity-table', DATA_SET_ID, 'count', 'counts', TEST_SCOPE)
		).rejects.toMatchObject({ status: 409, type: '/problems/report-conflict' });
	});
});
