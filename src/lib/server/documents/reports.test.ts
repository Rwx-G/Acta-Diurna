import { Column, Param, StringChunk, type SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateDocument, type DocumentV1, type DocumentV1Input } from '$lib/schema';
import {
	syntheticV0Document,
	syntheticV0Migration
} from '$lib/schema/versions/__fixtures__/synthetic-v0.fixture';
import { structurallyEqual } from '$lib/skeletons/structural-equality';
import { AppError } from '$lib/server/problem';
import type { ReportRow } from '../db/schema';
import {
	assertShareable,
	createReport,
	createReportWithDocument,
	deleteDraft,
	diffSeriesIssue,
	duplicateReport,
	getPublishedDocument,
	getReport,
	listReports,
	listSeriesIssues,
	publishReport,
	unpublishToDraft,
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
	series: [] as Record<string, unknown>[],
	orderBys: [] as { column: string; sql: string }[],
	listLimits: [] as number[],
	updates: [] as { column: string; value: unknown; set: Record<string, unknown> }[],
	deleteFilters: [] as { column: string; value: unknown }[],
	selectProjections: [] as (string[] | undefined)[]
}));

/** The drizzle table's SQL name (e.g. 'reports', 'report_series'), off its Name symbol. */
function tableName(table: unknown): string {
	if (typeof table !== 'object' || table === null) return '';
	const sym = Object.getOwnPropertySymbols(table).find(
		(s) => s.toString() === 'Symbol(drizzle:Name)'
	);
	return sym ? String((table as Record<symbol, unknown>)[sym]) : '';
}

/** The column names of a drizzle `.select({...})` projection, or undefined for a bare select. */
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
	if (!column || !param) throw new Error('mock only supports eq(column, value) filters');
	return { column: column.name, value: param.value };
}

// `and(eq(id), eq(updated_at))` nests its operands; flatten the leaf eq filters
// so the optimistic-concurrency WHERE can be decoded the same way a bare eq is.
function decodeEqFilters(filter: unknown): { column: string; value: unknown }[] {
	const chunks = (filter as { queryChunks?: unknown[] }).queryChunks ?? [];
	const hasColumn = chunks.some((chunk) => chunk instanceof Column);
	if (hasColumn) return [decodeEqFilter(filter)];
	return chunks.flatMap((chunk) =>
		chunk && typeof chunk === 'object' && 'queryChunks' in chunk ? decodeEqFilters(chunk) : []
	);
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

vi.mock('$lib/server/mode', () => ({
	operatingMode: () => 'single',
	isMultiAuthor: () => false
}));

// A forked series is logged as a warning by orderByPredecessorChain; mock the
// logger so the warn is assertable and never spams the test output.
const loggerState = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('$lib/server/logger', () => ({ logger: loggerState }));

vi.mock('$lib/server/db/client', () => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const db: any = {
		// create/duplicate run their series + report writes in one transaction; the
		// mock models it as a pass-through so the same builder serves tx and db.
		transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(db),
		insert: (table: unknown) => ({
			values: (row: Record<string, unknown>) => {
				// A report-series insert is tracked separately so the report-count
				// assertions stay accurate now that create/duplicate also mint a series.
				if (tableName(table) === 'report_series') {
					dbState.series.push(row);
				} else {
					dbState.inserted.push(row);
					dbState.rowsById.set(String(row.id), row);
				}
				return Promise.resolve();
			}
		}),
		select: (projection?: unknown) => ({
			from: (table?: unknown) => {
				// The series-lineage read selects from report_series (the owner-scoped
				// lookup) then from reports (the issues of the series). Serve those from
				// the dedicated series store / a series-id filter so the chain assembles.
				if (tableName(table) === 'report_series') {
					return {
						where: (filter: SQL) => {
							const decoded = decodeEqFilters(filter);
							const idFilter = decoded.find((entry) => entry.column === 'id');
							return {
								limit: () => {
									const match = idFilter
										? dbState.series.find((s) => String(s.id) === String(idFilter.value))
										: undefined;
									return Promise.resolve(match ? [{ id: match.id }] : []);
								}
							};
						}
					};
				}
				dbState.selectProjections.push(decodeSelectProjection(projection));
				// One chainable builder so the list path (now `.$dynamic()` ->
				// optional `.where()` -> `.orderBy()` -> `.limit()`, keyset-paginated)
				// and the id lookup (`.where().limit()`) share the same mock. A lookup
				// is detected by an eq(id) where with no order; a list is detected by
				// an orderBy. The first orderBy argument carries the sort column.
				let lookup: { column: string; value: unknown } | null = null;
				let seriesId: { column: string; value: unknown } | null = null;
				let ordered = false;
				const builder = {
					$dynamic: () => builder,
					where: (filter: SQL) => {
						// The list keyset/owner WHERE is not a bare eq(id); only the id
						// lookup is. Decode leniently and remember an eq(id) for the lookup
						// branch; an eq(series_id) for the series-issues branch; anything
						// else is a list predicate the mock ignores.
						const decoded = decodeEqFilters(filter);
						lookup = decoded.find((entry) => entry.column === 'id') ?? null;
						seriesId = decoded.find((entry) => entry.column === 'series_id') ?? null;
						return builder;
					},
					orderBy: (order: SQL) => {
						ordered = true;
						dbState.orderBys.push(decodeOrderBy(order));
						// The series-issues read is .where(series_id).orderBy().limit(1000):
						// stay chainable so the trailing .limit() resolves to the series rows.
						return builder;
					},
					limit: (count: number) => {
						// A lookup short-circuits to the keyed row; the series-issues read
						// (an eq(series_id) where + orderBy) resolves to that series' reports
						// up to the cap; a plain list returns the ordered rows up to limit + 1.
						if (lookup !== null && !ordered) {
							if (lookup.column !== 'id') return Promise.resolve([]);
							const row = dbState.rowsById.get(String(lookup.value));
							return Promise.resolve(row ? [row] : []);
						}
						if (seriesId !== null) {
							const rows = [...dbState.rowsById.values()].filter(
								(row) => String(row.seriesId) === String(seriesId!.value)
							);
							return Promise.resolve(rows.slice(0, count));
						}
						dbState.listLimits.push(count);
						return Promise.resolve([...dbState.rowsById.values()].slice(0, count));
					}
				};
				return builder;
			}
		}),
		update: () => ({
			set: (set: Record<string, unknown>) => ({
				where: (filter: SQL) => {
					const decoded = decodeEqFilters(filter);
					const idFilter = decoded.find((entry) => entry.column === 'id');
					// Record the id-keyed view so existing assertions keep working.
					if (idFilter) dbState.updates.push({ ...idFilter, set });
					const row = idFilter ? dbState.rowsById.get(String(idFilter.value)) : undefined;
					// Every eq leaf must match the stored row for the update to land
					// (optimistic concurrency joins eq(updated_at)).
					const matches =
						row !== undefined &&
						decoded.every((entry) => {
							const current = (row as Record<string, unknown>)[
								entry.column === 'updated_at' ? 'updatedAt' : entry.column
							];
							const stored = current instanceof Date ? current.getTime() : current;
							const wanted = entry.value instanceof Date ? entry.value.getTime() : entry.value;
							return stored === wanted;
						});
					if (matches && idFilter) {
						dbState.rowsById.set(String(idFilter.value), { ...row, ...set });
					}
					return Promise.resolve({ rowCount: matches ? 1 : 0 });
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
	};
	return { getDb: () => db };
});

const UUIDV7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const TEST_SCOPE = { authorId: '01970000-0000-7000-8000-0000000000aa' };

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

/** A validated v1 document for seeding snapshot columns directly. */
function seedDocument(title = 'Quarterly Review'): DocumentV1 {
	const result = validateDocument(validDocument(title));
	if (!result.ok) throw new Error('seed document must be valid');
	return result.document;
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
		publishedDocument: null,
		publishedAt: null,
		ownerId: null,
		seriesId: null,
		predecessorId: null,
		issueLabel: null,
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
	dbState.series = [];
	dbState.orderBys = [];
	dbState.listLimits = [];
	dbState.updates = [];
	dbState.deleteFilters = [];
	dbState.selectProjections = [];
	loggerState.warn.mockClear();
});

describe('createReport', () => {
	it('stores a draft with a schema-valid starter document', async () => {
		const report = await createReport('Weekly Ops Report', TEST_SCOPE);

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
		const error = await expectAppError(createReport('', TEST_SCOPE), 422);

		expect(error.errors?.[0].path).toBe('title');
		expect(dbState.inserted).toHaveLength(0);
	});

	it('starts its own one-issue series with a null predecessor (story 9.1)', async () => {
		const report = await createReport('Weekly Ops Report', TEST_SCOPE);

		// A fresh series was minted and stamped on the report; no predecessor yet.
		expect(dbState.series).toHaveLength(1);
		expect(report.seriesId).toBe(dbState.series[0].id);
		expect(report.predecessorId).toBeNull();
		expect(report.issueLabel).toBeNull();
		// The series carries the creating author, so it is owner-consistent with its issue.
		expect(dbState.series[0].ownerId).toBe(TEST_SCOPE.authorId);
	});
});

describe('createReportWithDocument', () => {
	it('stores a draft seeded with the given document (skeleton instantiation path)', async () => {
		const report = await createReportWithDocument(validDocument('From Skeleton'), TEST_SCOPE);

		expect(report.id).toMatch(UUIDV7_PATTERN);
		expect(report.status).toBe('draft');
		expect(report.schemaVersion).toBe(1);
		expect(report.title).toBe('From Skeleton');
		expect(report.document.sections).toHaveLength(1);
		expect(dbState.inserted).toHaveLength(1);
		expect(dbState.inserted[0].id).toBe(report.id);
	});

	it('mints a fresh row id per call so two reports from one document are distinct', async () => {
		const document = validDocument('Recurring');

		const first = await createReportWithDocument(document, TEST_SCOPE);
		const second = await createReportWithDocument(document, TEST_SCOPE);

		expect(first.id).not.toBe(second.id);
		expect(first.document).toEqual(second.document);
		expect(dbState.inserted).toHaveLength(2);
	});

	it('rejects an invalid document with a 422 before touching the database', async () => {
		await expectAppError(
			createReportWithDocument({ version: 1, title: '', sections: [] }, TEST_SCOPE),
			422
		);
		expect(dbState.inserted).toHaveLength(0);
	});
});

describe('duplicateReport', () => {
	it('duplicates a draft into a fresh draft with a distinct id', async () => {
		const source = seedReport();

		const copy = await duplicateReport(source.id, TEST_SCOPE);

		expect(copy.id).toMatch(UUIDV7_PATTERN);
		expect(copy.id).not.toBe(source.id);
		expect(copy.status).toBe('draft');
		expect(copy.schemaVersion).toBe(source.schemaVersion);
		expect(dbState.inserted).toHaveLength(1);
		expect(dbState.inserted[0].id).toBe(copy.id);
	});

	it('forces a published source to a draft and clears the publish snapshot', async () => {
		const source = seedReport({
			status: 'published',
			publishedDocument: seedDocument(),
			publishedAt: new Date('2026-06-12T09:00:00Z')
		});

		const copy = await duplicateReport(source.id, TEST_SCOPE);

		expect(copy.status).toBe('draft');
		expect(copy.publishedDocument).toBeNull();
		expect(copy.publishedAt).toBeNull();
		// The source is untouched: still the published report it was.
		expect(dbState.rowsById.get(source.id)?.status).toBe('published');
	});

	it('copies the source structure, bindings, and content', async () => {
		const source = seedReport();

		const copy = await duplicateReport(source.id, TEST_SCOPE);

		expect(copy.document).toEqual(source.document);
		expect(structurallyEqual(copy.document, source.document)).toBe(true);
	});

	it('deep-copies the document so mutating the copy never touches the source', async () => {
		const source = seedReport();

		const copy = await duplicateReport(source.id, TEST_SCOPE);
		copy.document.sections[0].title = 'Mutated In The Copy';

		const storedSource = dbState.rowsById.get(source.id) as ReportRow;
		expect(storedSource.document.sections[0].title).toBe('Overview');
	});

	it('throws 404 for an unknown id', async () => {
		await expectAppError(duplicateReport('01970000-0000-7000-8000-00000000dead', TEST_SCOPE), 404);
		expect(dbState.inserted).toHaveLength(0);
	});

	it('throws 404 for a malformed id without querying', async () => {
		await expectAppError(duplicateReport('not-a-uuid', TEST_SCOPE), 404);
		expect(dbState.inserted).toHaveLength(0);
	});

	it('records the lineage edge: predecessor is the source, series is inherited (story 9.1)', async () => {
		const source = seedReport({ seriesId: '01970000-0000-7000-8000-0000000000c1' });

		const copy = await duplicateReport(source.id, TEST_SCOPE);

		expect(copy.predecessorId).toBe(source.id);
		// The source already had a series, so no new one is minted; the copy joins it.
		expect(copy.seriesId).toBe(source.seriesId);
		expect(dbState.series).toHaveLength(0);
	});

	it('establishes a series for a legacy source with none and backfills the source onto it', async () => {
		const source = seedReport({ seriesId: null });

		const copy = await duplicateReport(source.id, TEST_SCOPE);

		// A fresh series was minted, assigned to BOTH the source and the new issue.
		expect(dbState.series).toHaveLength(1);
		expect(copy.seriesId).toBe(dbState.series[0].id);
		expect(copy.predecessorId).toBe(source.id);
		const storedSource = dbState.rowsById.get(source.id) as ReportRow;
		expect(storedSource.seriesId).toBe(copy.seriesId);
	});
});

describe('getReport', () => {
	it('returns the stored report by id', async () => {
		const row = seedReport();

		const report = await getReport(row.id, TEST_SCOPE);

		expect(report.id).toBe(row.id);
		expect(report.document).toEqual(row.document);
	});

	it('throws 404 for an unknown id', async () => {
		await expectAppError(getReport('01970000-0000-7000-8000-00000000dead', TEST_SCOPE), 404);
	});

	it('throws 404 for a malformed id without querying', async () => {
		await expectAppError(getReport('not-a-uuid', TEST_SCOPE), 404);
	});
});

describe('listSeriesIssues', () => {
	const SERIES_ID = '01970000-0000-7000-8000-0000000000c1';

	function seedSeries(): void {
		dbState.series.push({ id: SERIES_ID, ownerId: TEST_SCOPE.authorId });
	}

	function seedIssue(
		id: string,
		predecessorId: string | null,
		overrides: Partial<ReportRow> = {}
	): void {
		seedReport({ id, seriesId: SERIES_ID, predecessorId, ...overrides });
	}

	it('orders the issues by the predecessor chain, not by insertion or publish date', async () => {
		seedSeries();
		// Seed deliberately out of chain order; the chain is issue1 -> issue2 -> issue3.
		seedIssue('01970000-0000-7000-8000-000000000003', '01970000-0000-7000-8000-000000000002');
		seedIssue('01970000-0000-7000-8000-000000000001', null);
		seedIssue('01970000-0000-7000-8000-000000000002', '01970000-0000-7000-8000-000000000001');

		const issues = await listSeriesIssues(SERIES_ID, TEST_SCOPE);

		expect(issues.map((issue) => issue.id)).toEqual([
			'01970000-0000-7000-8000-000000000001',
			'01970000-0000-7000-8000-000000000002',
			'01970000-0000-7000-8000-000000000003'
		]);
		expect(issues[0].predecessorId).toBeNull();
		expect(issues[1].predecessorId).toBe(issues[0].id);
	});

	it('keeps every branch of a forked series (two issues sharing a predecessor), no silent drop', async () => {
		seedSeries();
		// A corrupted fork: issue2 AND issue3 both point back at issue1. A
		// Map<predecessor, issue> would let the later sibling overwrite the earlier
		// and drop a branch; the chain walk must keep BOTH, deterministically in
		// input order (the issues query orders by created_at, id).
		seedIssue('01970000-0000-7000-8000-000000000001', null);
		seedIssue('01970000-0000-7000-8000-000000000002', '01970000-0000-7000-8000-000000000001');
		seedIssue('01970000-0000-7000-8000-000000000003', '01970000-0000-7000-8000-000000000001');

		const issues = await listSeriesIssues(SERIES_ID, TEST_SCOPE);

		// All three issues are present (none dropped), head first, then both branches
		// in input order.
		expect(issues.map((issue) => issue.id)).toEqual([
			'01970000-0000-7000-8000-000000000001',
			'01970000-0000-7000-8000-000000000002',
			'01970000-0000-7000-8000-000000000003'
		]);
		// The corrupted fork is observable in the logs, not silently swallowed.
		expect(loggerState.warn).toHaveBeenCalled();
	});

	it('returns a single-issue series as a one-element chain', async () => {
		seedSeries();
		seedIssue('01970000-0000-7000-8000-000000000001', null);

		const issues = await listSeriesIssues(SERIES_ID, TEST_SCOPE);

		expect(issues).toHaveLength(1);
		expect(issues[0].id).toBe('01970000-0000-7000-8000-000000000001');
	});

	it('throws 404 for an unknown series id', async () => {
		await expectAppError(listSeriesIssues('01970000-0000-7000-8000-00000000dead', TEST_SCOPE), 404);
	});

	it('throws 404 for a malformed series id without querying', async () => {
		await expectAppError(listSeriesIssues('not-a-uuid', TEST_SCOPE), 404);
	});

	it('projects only the issue metadata, never the heavy JSONB document columns (E1)', async () => {
		seedSeries();
		seedIssue('01970000-0000-7000-8000-000000000001', null);
		dbState.selectProjections = [];

		await listSeriesIssues(SERIES_ID, TEST_SCOPE);

		// The issues read selects the metadata projection only (the series lookup
		// projects id; it does not go through the recorded projections path).
		expect(dbState.selectProjections.flat()).not.toContain('document');
		expect(dbState.selectProjections.flat()).not.toContain('published_document');
	});
});

describe('listReports', () => {
	it('returns a page projection ordered by updated_at descending', async () => {
		seedReport();
		seedReport({
			id: '01970000-0000-7000-8000-000000000002',
			title: 'Second Report',
			status: 'published'
		});

		const page = await listReports(TEST_SCOPE);

		expect(page.items).toHaveLength(2);
		// Under the default page size both rows fit, so this is the last page.
		expect(page.nextCursor).toBeNull();
		expect(page.items[0]).toEqual({
			id: '01970000-0000-7000-8000-000000000001',
			title: 'Quarterly Review',
			status: 'draft',
			updatedAt: new Date('2026-06-12T08:00:00Z')
		});
		expect(Object.keys(page.items[1])).toEqual(['id', 'title', 'status', 'updatedAt']);
		// The keyset orders on (updated_at, id); the first order key is updated_at desc.
		expect(dbState.orderBys[0].column).toBe('updated_at');
		expect(dbState.orderBys[0].sql).toContain('desc');
	});

	it('projects only the summary columns, never the heavy JSONB document columns', async () => {
		seedReport();

		await listReports(TEST_SCOPE);

		expect(dbState.selectProjections).toHaveLength(1);
		expect(dbState.selectProjections[0]).toEqual(['id', 'title', 'status', 'updated_at']);
		expect(dbState.selectProjections[0]).not.toContain('document');
		expect(dbState.selectProjections[0]).not.toContain('published_document');
	});

	it('bounds the query: it fetches one more than the page size to detect a further page', async () => {
		seedReport();

		const page = await listReports(TEST_SCOPE, { limit: 2 });

		// limit + 1: a single seeded row is under the page size, so no next page.
		expect(dbState.listLimits).toEqual([3]);
		expect(page.nextCursor).toBeNull();
	});

	it('signals a further page: a full over-fetch yields a non-null nextCursor and drops the surplus', async () => {
		seedReport();
		seedReport({
			id: '01970000-0000-7000-8000-000000000002',
			title: 'Second Report',
			updatedAt: new Date('2026-06-12T09:00:00Z')
		});
		seedReport({
			id: '01970000-0000-7000-8000-000000000003',
			title: 'Third Report',
			updatedAt: new Date('2026-06-12T10:00:00Z')
		});

		// limit 2 fetches 3; the surplus row signals a next page and is dropped.
		const first = await listReports(TEST_SCOPE, { limit: 2 });
		expect(first.items).toHaveLength(2);
		expect(first.nextCursor).not.toBeNull();
		// The cursor encodes the last KEPT row, so it never overlaps the next page.
		const lastKept = first.items[first.items.length - 1];
		expect(first.nextCursor).toBe(
			Buffer.from(`${lastKept.updatedAt.toISOString()}|${lastKept.id}`, 'utf8').toString(
				'base64url'
			)
		);
	});
});

describe('updateReportDocument', () => {
	it('persists a valid document and mirrors title and version on the row', async () => {
		const row = seedReport();

		const before = Date.now();
		const report = await updateReportDocument(
			row.id,
			validDocument('Renamed Through Document'),
			TEST_SCOPE
		);
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

		const error = await expectAppError(updateReportDocument(row.id, invalid, TEST_SCOPE), 422);

		expect(error.type).toBe('/problems/document-validation');
		const paths = error.errors?.map((entry) => entry.path);
		expect(paths).toContain('sections[0].blocks[1].assetId');
		expect(paths).toContain('sections[0].blocks[1].alt');
		expect(error.errors?.every((entry) => entry.message.length > 0)).toBe(true);
		expect(dbState.updates).toHaveLength(0);
	});

	it('throws 409 for a published report', async () => {
		const row = seedReport({ status: 'published' });

		await expectAppError(updateReportDocument(row.id, validDocument(), TEST_SCOPE), 409);
		expect(dbState.updates).toHaveLength(0);
	});

	it('rejects an over-budget document with 413 and persists nothing', async () => {
		const row = seedReport();
		// A SCHEMA-VALID document whose serialized size exceeds MAX_DOCUMENT_BYTES
		// (1 MB): a table well within the 10000-row / 5000-char-cell caps, but big
		// enough to blow the byte budget. This is the bind-path bypass the QA audit
		// flagged - the write chokepoint rejects it AFTER validation.
		const cell = 'x'.repeat(5000);
		const huge = validDocument('Over Budget');
		huge.sections[0].blocks = [
			{
				type: 'table',
				id: 'big-table',
				columns: [{ key: 'c', label: 'C' }],
				rows: Array.from({ length: 300 }, () => ({ c: cell }))
			}
		];

		const error = await expectAppError(updateReportDocument(row.id, huge, TEST_SCOPE), 413);
		expect(error.type).toBe('/problems/document-too-large');
		expect(dbState.updates).toHaveLength(0);
		// The stored row is untouched.
		expect(dbState.rowsById.get(row.id)?.title).toBe('Quarterly Review');
	});

	it('throws 404 for an unknown id', async () => {
		await expectAppError(
			updateReportDocument('01970000-0000-7000-8000-00000000dead', validDocument(), TEST_SCOPE),
			404
		);
	});

	it('writes when expectedUpdatedAt matches the stored timestamp', async () => {
		const row = seedReport();

		const report = await updateReportDocument(
			row.id,
			validDocument('Concurrency Match'),
			TEST_SCOPE,
			row.updatedAt
		);

		expect(report.title).toBe('Concurrency Match');
		expect(dbState.updates).toHaveLength(1);
	});

	it('throws 409 /problems/report-conflict when expectedUpdatedAt is stale', async () => {
		const row = seedReport();
		const stale = new Date(row.updatedAt.getTime() - 1000);

		const error = await expectAppError(
			updateReportDocument(row.id, validDocument('Loses The Race'), TEST_SCOPE, stale),
			409
		);

		expect(error.type).toBe('/problems/report-conflict');
		// The stored row is untouched: the losing write never lands.
		expect(dbState.rowsById.get(row.id)?.title).toBe('Quarterly Review');
	});
});

describe('updateReportTitle', () => {
	it('rewrites the document title and re-validates', async () => {
		const row = seedReport();

		const report = await updateReportTitle(row.id, 'Fresh Title', TEST_SCOPE);

		expect(report.title).toBe('Fresh Title');
		expect(report.document.title).toBe('Fresh Title');
		expect(dbState.updates).toHaveLength(1);
		expect(dbState.updates[0].set.title).toBe('Fresh Title');
	});

	it('throws 422 on an empty title', async () => {
		const row = seedReport();

		const error = await expectAppError(updateReportTitle(row.id, '', TEST_SCOPE), 422);

		expect(error.errors?.[0].path).toBe('title');
	});

	it('throws 409 for a published report', async () => {
		const row = seedReport({ status: 'published' });

		await expectAppError(updateReportTitle(row.id, 'New Title', TEST_SCOPE), 409);
	});
});

describe('deleteDraft', () => {
	it('deletes a draft by id', async () => {
		const row = seedReport();

		await deleteDraft(row.id, TEST_SCOPE);

		expect(dbState.deleteFilters).toEqual([{ column: 'id', value: row.id }]);
		expect(dbState.rowsById.size).toBe(0);
	});

	it('refuses to delete a published report with 409', async () => {
		const row = seedReport({ status: 'published' });

		const error = await expectAppError(deleteDraft(row.id, TEST_SCOPE), 409);

		expect(error.type).toBe('/problems/report-published');
		expect(dbState.deleteFilters).toHaveLength(0);
		expect(dbState.rowsById.has(row.id)).toBe(true);
	});

	it('reads only the status/metadata projection for the gate, never the JSONB columns (E1)', async () => {
		const row = seedReport();

		await deleteDraft(row.id, TEST_SCOPE);

		expect(dbState.selectProjections).toEqual([['id', 'status']]);
		expect(dbState.selectProjections[0]).not.toContain('document');
		expect(dbState.selectProjections[0]).not.toContain('published_document');
	});
});

describe('publishReport', () => {
	it('publishes a valid draft and freezes the snapshot with a publish timestamp', async () => {
		const row = seedReport();

		const report = await publishReport(row.id, TEST_SCOPE);

		expect(report.status).toBe('published');
		expect(report.publishedDocument).toEqual(row.document);
		expect(report.publishedAt).toBeInstanceOf(Date);
		const stored = dbState.rowsById.get(row.id);
		expect(stored?.status).toBe('published');
		expect(stored?.publishedDocument).toEqual(row.document);
	});

	it('is idempotent: publishing a published report is a no-op success', async () => {
		const publishedAt = new Date('2026-06-12T09:00:00Z');
		const row = seedReport({ status: 'published', publishedDocument: seedDocument(), publishedAt });

		const report = await publishReport(row.id, TEST_SCOPE);

		expect(report.status).toBe('published');
		// No re-snapshot: the publish timestamp is the one already on the row.
		expect(report.publishedAt).toEqual(publishedAt);
		expect(dbState.updates).toHaveLength(0);
	});

	it('refuses to publish an invalid draft with a 422 carrying actionable paths', async () => {
		const invalid = { version: 1, title: '', sections: [] } as unknown as DocumentV1;
		const row = seedReport({ document: invalid });

		const error = await expectAppError(publishReport(row.id, TEST_SCOPE), 422);

		expect(error.type).toBe('/problems/document-validation');
		const paths = error.errors?.map((entry) => entry.path);
		expect(paths).toContain('title');
		expect(paths).toContain('sections');
		// Nothing was published.
		expect(dbState.rowsById.get(row.id)?.status).toBe('draft');
	});

	it('throws 409 report-conflict when expectedUpdatedAt is stale', async () => {
		const row = seedReport();
		const stale = new Date(row.updatedAt.getTime() - 1000);

		const error = await expectAppError(publishReport(row.id, TEST_SCOPE, stale), 409);

		expect(error.type).toBe('/problems/report-conflict');
		expect(dbState.rowsById.get(row.id)?.status).toBe('draft');
	});

	it('throws 404 for an unknown id', async () => {
		await expectAppError(publishReport('01970000-0000-7000-8000-00000000dead', TEST_SCOPE), 404);
	});
});

describe('unpublishToDraft', () => {
	it('reverts a published report to draft and clears the snapshot', async () => {
		const row = seedReport({
			status: 'published',
			publishedDocument: seedDocument(),
			publishedAt: new Date('2026-06-12T09:00:00Z')
		});

		const report = await unpublishToDraft(row.id, TEST_SCOPE);

		expect(report.status).toBe('draft');
		expect(report.publishedDocument).toBeNull();
		expect(report.publishedAt).toBeNull();
		const stored = dbState.rowsById.get(row.id);
		expect(stored?.status).toBe('draft');
		expect(stored?.publishedDocument).toBeNull();
	});

	it('is idempotent: a draft is returned unchanged', async () => {
		const row = seedReport();

		const report = await unpublishToDraft(row.id, TEST_SCOPE);

		expect(report.status).toBe('draft');
		expect(dbState.updates).toHaveLength(0);
	});

	it('throws 404 for an unknown id', async () => {
		const error = await expectAppError(
			unpublishToDraft('01970000-0000-7000-8000-00000000dead', TEST_SCOPE),
			404
		);

		expect(error.type).toBe('/problems/report-not-found');
	});

	it('round-trips: publish then unpublish leaves the draft document authoritative', async () => {
		const row = seedReport();

		await publishReport(row.id, TEST_SCOPE);
		const reverted = await unpublishToDraft(row.id, TEST_SCOPE);

		expect(reverted.status).toBe('draft');
		expect(reverted.document).toEqual(row.document);
		expect(reverted.publishedDocument).toBeNull();
	});
});

describe('publish snapshot isolation', () => {
	it('serves the same published document throughout the published window, across re-reads', async () => {
		const row = seedReport();
		await publishReport(row.id, TEST_SCOPE);

		// Assert via the reader-served path (a re-read), not a captured local
		// reference: while the report stays published, getPublishedDocument must
		// return the publish-time document on every call.
		const servedFirst = await getPublishedDocument(row.id);
		const servedAgain = await getPublishedDocument(row.id);
		expect(servedFirst.title).toBe('Quarterly Review');
		expect(servedAgain.title).toBe('Quarterly Review');

		// Editing requires unpublish first (1.5 guard), so flip to draft, edit, and
		// re-publish a new edition. The previously served document never changed
		// under the draft edit; only the next publish advances the snapshot.
		await unpublishToDraft(row.id, TEST_SCOPE);
		await updateReportDocument(row.id, validDocument('Draft Moved On'), TEST_SCOPE);
		const draft = await getReport(row.id, TEST_SCOPE);
		expect(draft.document.title).toBe('Draft Moved On');

		await publishReport(row.id, TEST_SCOPE);
		const servedAfterRepublish = await getPublishedDocument(row.id);
		expect(servedAfterRepublish.title).toBe('Draft Moved On');
		// The immutability guarantee: the document served during the first published
		// window was never the in-progress draft.
		expect(servedFirst.title).toBe('Quarterly Review');
	});

	it('re-publishing freezes the latest draft into a new snapshot', async () => {
		const row = seedReport();
		await publishReport(row.id, TEST_SCOPE);
		await unpublishToDraft(row.id, TEST_SCOPE);
		await updateReportDocument(row.id, validDocument('Second Edition'), TEST_SCOPE);

		const republished = await publishReport(row.id, TEST_SCOPE);

		expect(republished.publishedDocument?.title).toBe('Second Edition');
	});
});

describe('getPublishedDocument', () => {
	it('returns the migrated, validated snapshot of a published report', async () => {
		const row = seedReport();
		await publishReport(row.id, TEST_SCOPE);

		const document = await getPublishedDocument(row.id);

		expect(document.title).toBe('Quarterly Review');
		expect(document.version).toBe(1);
	});

	it('throws 409 not-published for a draft (no snapshot to serve)', async () => {
		const row = seedReport();

		const error = await expectAppError(getPublishedDocument(row.id), 409);

		expect(error.type).toBe('/problems/report-not-published');
	});

	it('reads only the reader projection (status + published snapshot), never the draft document (E1)', async () => {
		const row = seedReport({
			status: 'published',
			publishedDocument: seedDocument(),
			publishedAt: new Date('2026-06-12T09:00:00Z')
		});
		dbState.selectProjections = [];

		const document = await getPublishedDocument(row.id);

		// The single read pulls only id/status/published_document - never the draft.
		expect(dbState.selectProjections).toEqual([['id', 'status', 'published_document']]);
		expect(dbState.selectProjections[0]).not.toContain('document');
		// The caller still receives the snapshot it serves.
		expect(document.title).toBe('Quarterly Review');
	});

	it('strips author-only speaker notes before serving a reader (Story 6.2 privacy)', async () => {
		// A published snapshot carrying speaker notes on its section: notes are
		// authored for the presenter only and must NEVER reach a reader. The reader
		// chokepoint strips them, so neither the rendered HTML nor the hydration
		// payload a reader route serializes can carry them.
		const withNotes = validateDocument({
			version: 1,
			title: 'Briefed Report',
			sections: [
				{
					id: 'overview',
					title: 'Overview',
					notes: 'Open with the headline number, then pause for questions.',
					blocks: [{ type: 'text', id: 'intro', paragraphs: [[{ text: 'All good.' }]] }]
				}
			]
		});
		if (!withNotes.ok) throw new Error('seed document must be valid');
		const row = seedReport({
			status: 'published',
			publishedDocument: withNotes.document,
			publishedAt: new Date('2026-06-12T09:00:00Z')
		});

		const document = await getPublishedDocument(row.id);

		expect(document.sections[0].notes).toBeUndefined();
		expect(JSON.stringify(document)).not.toContain('headline number');
		// The stored snapshot is untouched: only the served copy is stripped.
		const stored = dbState.rowsById.get(row.id) as ReportRow;
		expect(stored.publishedDocument?.sections[0].notes).toBe(
			'Open with the headline number, then pause for questions.'
		);
	});

	it('migrates a v(N-1) published snapshot forward before serving it (FR7 reader path)', async () => {
		// A snapshot frozen under an earlier schema version: the synthetic v0 shape
		// (version 0, `name` instead of `title`). This is the Epic 3 reader entry
		// point, so the migration seam is exercised end to end through the service.
		const row = seedReport({
			status: 'published',
			publishedDocument: syntheticV0Document as unknown as DocumentV1,
			publishedAt: new Date('2026-06-12T09:00:00Z')
		});

		const document = await getPublishedDocument(row.id, [syntheticV0Migration]);

		expect(document.version).toBe(1);
		expect(document.title).toBe('Legacy Quarterly Report');
	});

	it('returns the unsupported-version error when no migration reaches the snapshot version', async () => {
		const row = seedReport({
			status: 'published',
			publishedDocument: syntheticV0Document as unknown as DocumentV1,
			publishedAt: new Date('2026-06-12T09:00:00Z')
		});

		const error = await expectAppError(getPublishedDocument(row.id), 422);

		expect(error.type).toBe('/problems/document-validation');
		expect(error.errors?.[0].path).toBe('version');
	});
});

describe('diffSeriesIssue', () => {
	const ISSUE_ID = '01970000-0000-7000-8000-000000000010';
	const PRED_ID = '01970000-0000-7000-8000-000000000011';

	/** A validated single-section document with one text block, content set by `prose`. */
	function snapshot(prose: string): DocumentV1 {
		const result = validateDocument({
			version: 1,
			title: 'Quarterly Review',
			sections: [
				{
					id: 'overview',
					title: 'Overview',
					blocks: [{ type: 'text', id: 'intro', paragraphs: [[{ text: prose }]] }]
				}
			]
		});
		if (!result.ok) throw new Error('snapshot must be valid');
		return result.document;
	}

	/** A validated snapshot whose section and block ids are caller-chosen, for disjoint-lineage fixtures. */
	function snapshotWithIds(sectionId: string, blockId: string): DocumentV1 {
		const result = validateDocument({
			version: 1,
			title: 'Quarterly Review',
			sections: [
				{
					id: sectionId,
					title: 'Overview',
					blocks: [{ type: 'text', id: blockId, paragraphs: [[{ text: 'prose' }]] }]
				}
			]
		});
		if (!result.ok) throw new Error('snapshot must be valid');
		return result.document;
	}

	it('diffs a published issue against its published predecessor and flags the content change', async () => {
		seedReport({
			id: PRED_ID,
			status: 'published',
			publishedDocument: snapshot('Old prose'),
			publishedAt: new Date('2026-06-12T09:00:00Z')
		});
		seedReport({
			id: ISSUE_ID,
			predecessorId: PRED_ID,
			status: 'published',
			publishedDocument: snapshot('New prose'),
			publishedAt: new Date('2026-06-13T09:00:00Z')
		});

		const result = await diffSeriesIssue(ISSUE_ID, TEST_SCOPE);

		expect(result.kind).toBe('diff');
		if (result.kind !== 'diff') throw new Error('expected a computed diff');
		const block = result.sections.flatMap((s) => s.blocks).find((b) => b.id === 'intro');
		expect(block?.change).toBe('kept');
		expect(block?.contentChanged).toBe(true);
		expect(block?.dataChanged).toBe(false);
	});

	it('returns a neutral no-predecessor result for the first issue (null predecessor)', async () => {
		seedReport({
			id: ISSUE_ID,
			predecessorId: null,
			status: 'published',
			publishedDocument: snapshot('First edition'),
			publishedAt: new Date('2026-06-13T09:00:00Z')
		});

		const result = await diffSeriesIssue(ISSUE_ID, TEST_SCOPE);

		expect(result).toEqual({ kind: 'no-predecessor', reason: 'first-issue' });
	});

	it('returns no-predecessor when the predecessor exists but is unpublished (no snapshot)', async () => {
		seedReport({ id: PRED_ID, status: 'draft', predecessorId: null });
		seedReport({
			id: ISSUE_ID,
			predecessorId: PRED_ID,
			status: 'published',
			publishedDocument: snapshot('New edition'),
			publishedAt: new Date('2026-06-13T09:00:00Z')
		});

		const result = await diffSeriesIssue(ISSUE_ID, TEST_SCOPE);

		// The two no-predecessor causes are kept apart: an unpublished predecessor is
		// tagged distinctly from a genuine first issue so a later surface (9.5) messages
		// them differently.
		expect(result).toEqual({ kind: 'no-predecessor', reason: 'predecessor-unpublished' });
	});

	it('returns substantial-drift when the two published snapshots share no block ids', async () => {
		seedReport({
			id: PRED_ID,
			status: 'published',
			publishedDocument: snapshotWithIds('old-section', 'old-block'),
			publishedAt: new Date('2026-06-12T09:00:00Z')
		});
		seedReport({
			id: ISSUE_ID,
			predecessorId: PRED_ID,
			status: 'published',
			publishedDocument: snapshotWithIds('new-section', 'new-block'),
			publishedAt: new Date('2026-06-13T09:00:00Z')
		});

		const result = await diffSeriesIssue(ISSUE_ID, TEST_SCOPE);

		expect(result.kind).toBe('substantial-drift');
		if (result.kind === 'substantial-drift') expect(result.overlap).toBe(0);
	});

	it('throws 409 not-published when the issue itself is a draft (no edition to diff)', async () => {
		seedReport({ id: ISSUE_ID, predecessorId: PRED_ID, status: 'draft' });

		const error = await expectAppError(diffSeriesIssue(ISSUE_ID, TEST_SCOPE), 409);

		expect(error.type).toBe('/problems/report-not-published');
	});

	it('throws 404 for an unknown issue id', async () => {
		await expectAppError(diffSeriesIssue('01970000-0000-7000-8000-00000000dead', TEST_SCOPE), 404);
	});

	it('throws 404 for a malformed issue id without querying', async () => {
		await expectAppError(diffSeriesIssue('not-a-uuid', TEST_SCOPE), 404);
	});

	it('throws 404 when the predecessor edge points at an unknown report (corrupted link)', async () => {
		seedReport({
			id: ISSUE_ID,
			predecessorId: '01970000-0000-7000-8000-00000000beef',
			status: 'published',
			publishedDocument: snapshot('New edition'),
			publishedAt: new Date('2026-06-13T09:00:00Z')
		});

		// The predecessor is re-resolved under the owner scope; an unresolvable edge is
		// the same neutral 404, never a leak or a crash.
		await expectAppError(diffSeriesIssue(ISSUE_ID, TEST_SCOPE), 404);
	});
});

describe('assertShareable', () => {
	it('passes for a published report', () => {
		expect(() => assertShareable({ status: 'published' })).not.toThrow();
	});

	it('throws 409 not-published for a draft', async () => {
		await expectAppError(
			Promise.resolve().then(() => assertShareable({ status: 'draft' })),
			409
		);
	});
});
