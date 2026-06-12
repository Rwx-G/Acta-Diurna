import { Column, Param, StringChunk, type SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateDocument, type DocumentV1Input } from '$lib/schema';
import { AppError } from '$lib/server/problem';
import type { ReportRow } from '../db/schema';
import {
	createReport,
	deleteDraft,
	getReport,
	listReports,
	updateReportDocument,
	updateReportTitle
} from './reports';

// The mock store is keyed by report id and decodes drizzle `eq()` filters the
// same way the 1.4 sessions mock does: a regression that filters on the wrong
// column misses the map and fails the lookup tests. `orderBy` arguments are
// decoded too, so the updated-desc list contract is asserted, not assumed.
const dbState = vi.hoisted(() => ({
	rowsById: new Map<string, Record<string, unknown>>(),
	inserted: [] as Record<string, unknown>[],
	orderBys: [] as { column: string; sql: string }[],
	updates: [] as { column: string; value: unknown; set: Record<string, unknown> }[],
	deleteFilters: [] as { column: string; value: unknown }[]
}));

function decodeEqFilter(filter: unknown): { column: string; value: unknown } {
	const chunks = (filter as { queryChunks: unknown[] }).queryChunks;
	const column = chunks.find((chunk): chunk is Column => chunk instanceof Column);
	const param = chunks.find((chunk): chunk is Param => chunk instanceof Param);
	if (!column || !param) throw new Error('mock only supports eq(column, value) filters');
	return { column: column.name, value: param.value };
}

function decodeOrderBy(order: unknown): { column: string; sql: string } {
	const chunks = (order as { queryChunks: unknown[] }).queryChunks;
	const column = chunks.find((chunk): chunk is Column => chunk instanceof Column);
	if (!column) throw new Error('mock only supports column-based order expressions');
	const sql = chunks
		.filter((chunk): chunk is StringChunk => chunk instanceof StringChunk)
		.flatMap((chunk) => chunk.value)
		.join('');
	return { column: column.name, sql };
}

vi.mock('$lib/server/db/client', () => ({
	getDb: () => ({
		insert: () => ({
			values: (row: Record<string, unknown>) => {
				dbState.inserted.push(row);
				dbState.rowsById.set(String(row.id), row);
				return Promise.resolve();
			}
		}),
		select: () => ({
			from: () => ({
				where: (filter: SQL) => {
					const decoded = decodeEqFilter(filter);
					return {
						limit: () => {
							if (decoded.column !== 'id') return Promise.resolve([]);
							const row = dbState.rowsById.get(String(decoded.value));
							return Promise.resolve(row ? [row] : []);
						}
					};
				},
				orderBy: (order: SQL) => {
					dbState.orderBys.push(decodeOrderBy(order));
					return Promise.resolve([...dbState.rowsById.values()]);
				}
			})
		}),
		update: () => ({
			set: (set: Record<string, unknown>) => ({
				where: (filter: SQL) => {
					const decoded = decodeEqFilter(filter);
					dbState.updates.push({ ...decoded, set });
					if (decoded.column === 'id') {
						const row = dbState.rowsById.get(String(decoded.value));
						if (row) dbState.rowsById.set(String(decoded.value), { ...row, ...set });
					}
					return Promise.resolve();
				}
			})
		}),
		delete: () => ({
			where: (filter: SQL) => {
				const decoded = decodeEqFilter(filter);
				dbState.deleteFilters.push(decoded);
				if (decoded.column === 'id') dbState.rowsById.delete(String(decoded.value));
				return Promise.resolve();
			}
		})
	})
}));

const UUIDV7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function validDocument(title = 'Quarterly Review'): DocumentV1Input {
	return {
		version: 1,
		title,
		sections: [
			{
				id: 'overview',
				title: 'Overview',
				blocks: [{ type: 'text', id: 'intro', paragraphs: [[{ text: 'All good.' }]] }]
			}
		]
	};
}

function seedReport(overrides: Partial<ReportRow> = {}): ReportRow {
	const document = validateDocument(validDocument());
	if (!document.ok) throw new Error('seed document must be valid');
	const row: ReportRow = {
		id: '01970000-0000-7000-8000-000000000001',
		title: document.document.title,
		status: 'draft',
		schemaVersion: 1,
		document: document.document,
		createdAt: new Date('2026-06-12T08:00:00Z'),
		updatedAt: new Date('2026-06-12T08:00:00Z'),
		...overrides
	};
	dbState.rowsById.set(row.id, row);
	return row;
}

async function expectAppError(promise: Promise<unknown>, status: number): Promise<AppError> {
	try {
		await promise;
	} catch (thrown) {
		expect(thrown).toBeInstanceOf(AppError);
		const appError = thrown as AppError;
		expect(appError.status).toBe(status);
		return appError;
	}
	throw new Error(`expected an AppError with status ${status}`);
}

beforeEach(() => {
	dbState.rowsById.clear();
	dbState.inserted = [];
	dbState.orderBys = [];
	dbState.updates = [];
	dbState.deleteFilters = [];
});

describe('createReport', () => {
	it('stores a draft with a schema-valid starter document', async () => {
		const report = await createReport('Weekly Ops Report');

		expect(report.id).toMatch(UUIDV7_PATTERN);
		expect(report.status).toBe('draft');
		expect(report.schemaVersion).toBe(1);
		expect(report.title).toBe('Weekly Ops Report');
		expect(report.document.title).toBe('Weekly Ops Report');
		expect(report.document.sections).toHaveLength(1);
		const section = report.document.sections[0];
		expect(section.title).toBe('Introduction');
		expect(section.blocks).toHaveLength(1);
		expect(section.blocks[0].type).toBe('text');
		expect(validateDocument(report.document).ok).toBe(true);

		expect(dbState.inserted).toHaveLength(1);
		expect(dbState.inserted[0].id).toBe(report.id);
		expect(dbState.inserted[0].status).toBe('draft');
	});

	it('rejects an invalid title with a 422 before touching the database', async () => {
		const error = await expectAppError(createReport(''), 422);

		expect(error.errors?.[0].path).toBe('title');
		expect(dbState.inserted).toHaveLength(0);
	});
});

describe('getReport', () => {
	it('returns the stored report by id', async () => {
		const row = seedReport();

		const report = await getReport(row.id);

		expect(report.id).toBe(row.id);
		expect(report.document).toEqual(row.document);
	});

	it('throws 404 for an unknown id', async () => {
		await expectAppError(getReport('01970000-0000-7000-8000-00000000dead'), 404);
	});

	it('throws 404 for a malformed id without querying', async () => {
		await expectAppError(getReport('not-a-uuid'), 404);
	});
});

describe('listReports', () => {
	it('returns the list projection ordered by updated_at descending', async () => {
		seedReport();
		seedReport({
			id: '01970000-0000-7000-8000-000000000002',
			title: 'Second Report',
			status: 'published'
		});

		const list = await listReports();

		expect(list).toHaveLength(2);
		expect(list[0]).toEqual({
			id: '01970000-0000-7000-8000-000000000001',
			title: 'Quarterly Review',
			status: 'draft',
			updatedAt: new Date('2026-06-12T08:00:00Z')
		});
		expect(Object.keys(list[1])).toEqual(['id', 'title', 'status', 'updatedAt']);
		expect(dbState.orderBys).toHaveLength(1);
		expect(dbState.orderBys[0].column).toBe('updated_at');
		expect(dbState.orderBys[0].sql).toContain('desc');
	});
});

describe('updateReportDocument', () => {
	it('persists a valid document and mirrors title and version on the row', async () => {
		const row = seedReport();

		const before = Date.now();
		const report = await updateReportDocument(row.id, validDocument('Renamed Through Document'));
		const after = Date.now();

		expect(report.title).toBe('Renamed Through Document');
		expect(report.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
		expect(report.updatedAt.getTime()).toBeLessThanOrEqual(after);
		expect(dbState.updates).toHaveLength(1);
		expect(dbState.updates[0].column).toBe('id');
		expect(dbState.updates[0].value).toBe(row.id);
		expect(dbState.updates[0].set.title).toBe('Renamed Through Document');
		expect(dbState.updates[0].set.schemaVersion).toBe(1);
	});

	it('throws 422 with actionable error paths for an invalid document', async () => {
		const row = seedReport();
		const invalid = validDocument();
		invalid.sections[0].blocks.push({
			type: 'image',
			id: 'figure',
			assetId: 'not-a-uuid',
			alt: ''
		});

		const error = await expectAppError(updateReportDocument(row.id, invalid), 422);

		expect(error.type).toBe('/problems/document-validation');
		const paths = error.errors?.map((entry) => entry.path);
		expect(paths).toContain('sections[0].blocks[1].assetId');
		expect(paths).toContain('sections[0].blocks[1].alt');
		expect(error.errors?.every((entry) => entry.message.length > 0)).toBe(true);
		expect(dbState.updates).toHaveLength(0);
	});

	it('throws 409 for a published report', async () => {
		const row = seedReport({ status: 'published' });

		await expectAppError(updateReportDocument(row.id, validDocument()), 409);
		expect(dbState.updates).toHaveLength(0);
	});

	it('throws 404 for an unknown id', async () => {
		await expectAppError(
			updateReportDocument('01970000-0000-7000-8000-00000000dead', validDocument()),
			404
		);
	});
});

describe('updateReportTitle', () => {
	it('rewrites the document title and re-validates', async () => {
		const row = seedReport();

		const report = await updateReportTitle(row.id, 'Fresh Title');

		expect(report.title).toBe('Fresh Title');
		expect(report.document.title).toBe('Fresh Title');
		expect(dbState.updates).toHaveLength(1);
		expect(dbState.updates[0].set.title).toBe('Fresh Title');
	});

	it('throws 422 on an empty title', async () => {
		const row = seedReport();

		const error = await expectAppError(updateReportTitle(row.id, ''), 422);

		expect(error.errors?.[0].path).toBe('title');
	});

	it('throws 409 for a published report', async () => {
		const row = seedReport({ status: 'published' });

		await expectAppError(updateReportTitle(row.id, 'New Title'), 409);
	});
});

describe('deleteDraft', () => {
	it('deletes a draft by id', async () => {
		const row = seedReport();

		await deleteDraft(row.id);

		expect(dbState.deleteFilters).toEqual([{ column: 'id', value: row.id }]);
		expect(dbState.rowsById.size).toBe(0);
	});

	it('refuses to delete a published report with 409', async () => {
		const row = seedReport({ status: 'published' });

		const error = await expectAppError(deleteDraft(row.id), 409);

		expect(error.type).toBe('/problems/report-published');
		expect(dbState.deleteFilters).toHaveLength(0);
		expect(dbState.rowsById.has(row.id)).toBe(true);
	});
});
