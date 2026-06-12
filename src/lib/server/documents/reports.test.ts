import { Column, Param, StringChunk, type SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateDocument, type DocumentV1, type DocumentV1Input } from '$lib/schema';
import {
	syntheticV0Document,
	syntheticV0Migration
} from '$lib/schema/versions/__fixtures__/synthetic-v0.fixture';
import { AppError } from '$lib/server/problem';
import type { ReportRow } from '../db/schema';
import {
	assertShareable,
	createReport,
	createReportWithDocument,
	deleteDraft,
	getPublishedDocument,
	getReport,
	listReports,
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

describe('createReportWithDocument', () => {
	it('stores a draft seeded with the given document (skeleton instantiation path)', async () => {
		const report = await createReportWithDocument(validDocument('From Skeleton'));

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

		const first = await createReportWithDocument(document);
		const second = await createReportWithDocument(document);

		expect(first.id).not.toBe(second.id);
		expect(first.document).toEqual(second.document);
		expect(dbState.inserted).toHaveLength(2);
	});

	it('rejects an invalid document with a 422 before touching the database', async () => {
		await expectAppError(createReportWithDocument({ version: 1, title: '', sections: [] }), 422);
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

	it('writes when expectedUpdatedAt matches the stored timestamp', async () => {
		const row = seedReport();

		const report = await updateReportDocument(
			row.id,
			validDocument('Concurrency Match'),
			row.updatedAt
		);

		expect(report.title).toBe('Concurrency Match');
		expect(dbState.updates).toHaveLength(1);
	});

	it('throws 409 /problems/report-conflict when expectedUpdatedAt is stale', async () => {
		const row = seedReport();
		const stale = new Date(row.updatedAt.getTime() - 1000);

		const error = await expectAppError(
			updateReportDocument(row.id, validDocument('Loses The Race'), stale),
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

describe('publishReport', () => {
	it('publishes a valid draft and freezes the snapshot with a publish timestamp', async () => {
		const row = seedReport();

		const report = await publishReport(row.id);

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

		const report = await publishReport(row.id);

		expect(report.status).toBe('published');
		// No re-snapshot: the publish timestamp is the one already on the row.
		expect(report.publishedAt).toEqual(publishedAt);
		expect(dbState.updates).toHaveLength(0);
	});

	it('refuses to publish an invalid draft with a 422 carrying actionable paths', async () => {
		const invalid = { version: 1, title: '', sections: [] } as unknown as DocumentV1;
		const row = seedReport({ document: invalid });

		const error = await expectAppError(publishReport(row.id), 422);

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

		const error = await expectAppError(publishReport(row.id, stale), 409);

		expect(error.type).toBe('/problems/report-conflict');
		expect(dbState.rowsById.get(row.id)?.status).toBe('draft');
	});

	it('throws 404 for an unknown id', async () => {
		await expectAppError(publishReport('01970000-0000-7000-8000-00000000dead'), 404);
	});
});

describe('unpublishToDraft', () => {
	it('reverts a published report to draft and clears the snapshot', async () => {
		const row = seedReport({
			status: 'published',
			publishedDocument: seedDocument(),
			publishedAt: new Date('2026-06-12T09:00:00Z')
		});

		const report = await unpublishToDraft(row.id);

		expect(report.status).toBe('draft');
		expect(report.publishedDocument).toBeNull();
		expect(report.publishedAt).toBeNull();
		const stored = dbState.rowsById.get(row.id);
		expect(stored?.status).toBe('draft');
		expect(stored?.publishedDocument).toBeNull();
	});

	it('is idempotent: a draft is returned unchanged', async () => {
		const row = seedReport();

		const report = await unpublishToDraft(row.id);

		expect(report.status).toBe('draft');
		expect(dbState.updates).toHaveLength(0);
	});

	it('throws 404 for an unknown id', async () => {
		const error = await expectAppError(
			unpublishToDraft('01970000-0000-7000-8000-00000000dead'),
			404
		);

		expect(error.type).toBe('/problems/report-not-found');
	});

	it('round-trips: publish then unpublish leaves the draft document authoritative', async () => {
		const row = seedReport();

		await publishReport(row.id);
		const reverted = await unpublishToDraft(row.id);

		expect(reverted.status).toBe('draft');
		expect(reverted.document).toEqual(row.document);
		expect(reverted.publishedDocument).toBeNull();
	});
});

describe('publish snapshot isolation', () => {
	it('serves the same published document throughout the published window, across re-reads', async () => {
		const row = seedReport();
		await publishReport(row.id);

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
		await unpublishToDraft(row.id);
		await updateReportDocument(row.id, validDocument('Draft Moved On'));
		const draft = await getReport(row.id);
		expect(draft.document.title).toBe('Draft Moved On');

		await publishReport(row.id);
		const servedAfterRepublish = await getPublishedDocument(row.id);
		expect(servedAfterRepublish.title).toBe('Draft Moved On');
		// The immutability guarantee: the document served during the first published
		// window was never the in-progress draft.
		expect(servedFirst.title).toBe('Quarterly Review');
	});

	it('re-publishing freezes the latest draft into a new snapshot', async () => {
		const row = seedReport();
		await publishReport(row.id);
		await unpublishToDraft(row.id);
		await updateReportDocument(row.id, validDocument('Second Edition'));

		const republished = await publishReport(row.id);

		expect(republished.publishedDocument?.title).toBe('Second Edition');
	});
});

describe('getPublishedDocument', () => {
	it('returns the migrated, validated snapshot of a published report', async () => {
		const row = seedReport();
		await publishReport(row.id);

		const document = await getPublishedDocument(row.id);

		expect(document.title).toBe('Quarterly Review');
		expect(document.version).toBe(1);
	});

	it('throws 409 not-published for a draft (no snapshot to serve)', async () => {
		const row = seedReport();

		const error = await expectAppError(getPublishedDocument(row.id), 409);

		expect(error.type).toBe('/problems/report-not-published');
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
