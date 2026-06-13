import { Column, getTableName, Param, StringChunk, type SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBrick, BRICKS, type Brick } from '$lib/bricks';
import { structurallyEqual } from '$lib/skeletons/structural-equality';
import type { Scales } from '$lib/schema';
import { AppError } from '$lib/server/problem';
import {
	deleteSkeleton,
	getSkeleton,
	instantiateReport,
	listSkeletons,
	saveSkeleton
} from './skeletons.ts';

// One mock store per table (skeletons + reports), keyed by id. The `insert`,
// `select`, `orderBy` and `delete` chains decode drizzle `eq()` filters the same
// way the reports/sessions mocks do, so a regression that filters on the wrong
// column or table misses the map and fails the test. The skeletons insert
// simulates the (owner_id, name) unique index: a duplicate name FOR THE SAME OWNER
// throws a pg unique violation (code 23505), exactly what the service catches and
// translates to a 409. Cross-author name collisions do not trip it (the multi-mode
// tenancy proof lives in skeletons-tenancy.test.ts).
const dbState = vi.hoisted(() => ({
	skeletons: new Map<string, Record<string, unknown>>(),
	reports: new Map<string, Record<string, unknown>>(),
	orderBys: [] as { column: string; sql: string }[],
	deletes: [] as { table: string; column: string; value: unknown }[]
}));

function storeFor(name: string): Map<string, Record<string, unknown>> {
	return name === 'reports' ? dbState.reports : dbState.skeletons;
}

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

function uniqueViolation(): Error & { code: string } {
	return Object.assign(new Error('duplicate key value violates unique constraint'), {
		code: '23505'
	});
}

vi.mock('$lib/server/mode', () => ({
	operatingMode: () => 'single',
	isMultiAuthor: () => false
}));

const TEST_SCOPE = { authorId: '01970000-0000-7000-8000-0000000000aa' };

vi.mock('$lib/server/db/client', () => ({
	getDb: () => ({
		insert: (table: unknown) => ({
			values: (row: Record<string, unknown>) => {
				const tableName = getTableName(table as never);
				const store = storeFor(tableName);
				if (tableName === 'skeletons') {
					const clash = [...store.values()].some(
						(existing) => existing.name === row.name && existing.ownerId === row.ownerId
					);
					if (clash) return Promise.reject(uniqueViolation());
				}
				store.set(String(row.id), row);
				return Promise.resolve();
			}
		}),
		select: () => ({
			from: (table: unknown) => {
				const store = storeFor(getTableName(table as never));
				return {
					where: (filter: SQL) => {
						const decoded = decodeEqFilter(filter);
						return {
							limit: () => {
								if (decoded.column !== 'id') return Promise.resolve([]);
								const row = store.get(String(decoded.value));
								return Promise.resolve(row ? [row] : []);
							}
						};
					},
					orderBy: (order: SQL) => {
						dbState.orderBys.push(decodeOrderBy(order));
						return Promise.resolve([...store.values()]);
					}
				};
			}
		}),
		delete: (table: unknown) => ({
			where: (filter: SQL) => {
				const tableName = getTableName(table as never);
				const store = storeFor(tableName);
				const decoded = decodeEqFilter(filter);
				dbState.deletes.push({ table: tableName, ...decoded });
				if (decoded.column === 'id') store.delete(String(decoded.value));
				return Promise.resolve();
			}
		})
	})
}));

const UUIDV7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function draftFrom(title: string, ...brickIds: string[]) {
	return {
		version: 1 as const,
		title,
		sections: brickIds.map((id) => getBrick(id)!.factory())
	};
}

/** Merges every brick's companion scales (Epic 7), deduping by key like the real
 *  `appendBrick` composer: matrix + legend both declare the `sources` scale, and
 *  scale keys are unique per document, so the duplicate collapses to one. */
function companionScales(bricks: readonly Brick[]): Scales {
	const byKey = new Map<string, Scales[number]>();
	for (const brick of bricks) {
		for (const scale of brick.scales?.() ?? []) {
			if (!byKey.has(scale.key)) byKey.set(scale.key, scale);
		}
	}
	return [...byKey.values()];
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
	dbState.skeletons.clear();
	dbState.reports.clear();
	dbState.orderBys = [];
	dbState.deletes = [];
});

describe('saveSkeleton', () => {
	it('validates and persists a composed structure with a fresh UUIDv7 id', async () => {
		const saved = await saveSkeleton(draftFrom('My skeleton', 'cover', 'dataTable'), TEST_SCOPE);

		expect(saved.id).toMatch(UUIDV7_PATTERN);
		expect(saved.name).toBe('My skeleton');
		expect(saved.schemaVersion).toBe(1);
		expect(saved.document.sections).toHaveLength(2);
		expect(dbState.skeletons.size).toBe(1);
		expect(dbState.skeletons.get(saved.id)?.name).toBe('My skeleton');
	});

	it('persists a full library assembly', async () => {
		const draft = {
			version: 1 as const,
			title: 'Everything',
			// Seed companion scales the matrix + legend bricks reference (Epic 7),
			// deduped by key so the shared `sources` scale appears once.
			scales: companionScales(BRICKS),
			sections: BRICKS.map((brick) => brick.factory())
		};
		await expect(saveSkeleton(draft, TEST_SCOPE)).resolves.toBeDefined();
		expect(dbState.skeletons.size).toBe(1);
	});

	it('throws 409 /problems/skeleton-name-taken on a duplicate name', async () => {
		await saveSkeleton(draftFrom('Weekly ops', 'cover'), TEST_SCOPE);

		const error = await expectAppError(
			saveSkeleton(draftFrom('Weekly ops', 'summary'), TEST_SCOPE),
			409
		);

		expect(error.type).toBe('/problems/skeleton-name-taken');
		// The losing save never lands: still one skeleton, the first one.
		expect(dbState.skeletons.size).toBe(1);
	});

	it('blocks an empty section with a 422 carrying the error at the section path before persisting', async () => {
		const draft = draftFrom('Bad', 'cover');
		draft.sections[0].blocks = [];

		const error = await expectAppError(saveSkeleton(draft, TEST_SCOPE), 422);

		expect(error.errors?.[0].path).toMatch(/^sections\[0\]\.blocks$/);
		expect(error.errors?.[0].message).toContain('at least one block');
		expect(dbState.skeletons.size).toBe(0);
	});

	it('blocks an empty title with a 422', async () => {
		const draft = draftFrom('Bad', 'cover');
		draft.title = '';

		await expectAppError(saveSkeleton(draft, TEST_SCOPE), 422);
		expect(dbState.skeletons.size).toBe(0);
	});
});

describe('listSkeletons', () => {
	it('returns the id/name/updatedAt projection ordered by updated_at descending', async () => {
		await saveSkeleton(draftFrom('First', 'cover'), TEST_SCOPE);
		await saveSkeleton(draftFrom('Second', 'summary'), TEST_SCOPE);

		const list = await listSkeletons(TEST_SCOPE);

		expect(list).toHaveLength(2);
		expect(Object.keys(list[0])).toEqual(['id', 'name', 'updatedAt']);
		expect(list.map((entry) => entry.name).sort()).toEqual(['First', 'Second']);
		expect(dbState.orderBys).toHaveLength(1);
		expect(dbState.orderBys[0].column).toBe('updated_at');
		expect(dbState.orderBys[0].sql).toContain('desc');
	});
});

describe('getSkeleton', () => {
	it('returns the stored skeleton by id', async () => {
		const saved = await saveSkeleton(draftFrom('Lookup', 'cover'), TEST_SCOPE);

		const loaded = await getSkeleton(saved.id, TEST_SCOPE);

		expect(loaded.id).toBe(saved.id);
		expect(loaded.document).toEqual(saved.document);
	});

	it('throws 404 for an unknown id', async () => {
		await expectAppError(getSkeleton('01970000-0000-7000-8000-00000000dead', TEST_SCOPE), 404);
	});

	it('throws 404 for a malformed id without querying', async () => {
		await expectAppError(getSkeleton('not-a-uuid', TEST_SCOPE), 404);
	});
});

describe('deleteSkeleton', () => {
	it('deletes a skeleton by id', async () => {
		const saved = await saveSkeleton(draftFrom('Disposable', 'cover'), TEST_SCOPE);

		await deleteSkeleton(saved.id, TEST_SCOPE);

		expect(dbState.deletes).toEqual([{ table: 'skeletons', column: 'id', value: saved.id }]);
		expect(dbState.skeletons.size).toBe(0);
	});

	it('throws 404 for an unknown id and never issues a delete', async () => {
		await expectAppError(deleteSkeleton('01970000-0000-7000-8000-00000000dead', TEST_SCOPE), 404);
		expect(dbState.deletes).toHaveLength(0);
	});
});

describe('instantiateReport', () => {
	it('creates a draft report whose document mirrors the skeleton structure exactly (FR11)', async () => {
		const saved = await saveSkeleton(
			draftFrom('Recurring', 'cover', 'dataTable', 'kpiRow'),
			TEST_SCOPE
		);

		const report = await instantiateReport(saved.id, TEST_SCOPE);

		expect(report.id).toMatch(UUIDV7_PATTERN);
		expect(report.id).not.toBe(saved.id);
		expect(report.status).toBe('draft');
		expect(report.document).toEqual(saved.document);
		expect(structurallyEqual(report.document, saved.document)).toBe(true);
		expect(dbState.reports.size).toBe(1);
	});

	it('two reports from one skeleton are structurally identical (FR11)', async () => {
		const saved = await saveSkeleton(
			draftFrom('Quarterly', 'cover', 'summary', 'dataTable', 'chartSection', 'annex'),
			TEST_SCOPE
		);

		const first = await instantiateReport(saved.id, TEST_SCOPE);
		const second = await instantiateReport(saved.id, TEST_SCOPE);

		expect(first.id).not.toBe(second.id);
		expect(structurallyEqual(first.document, second.document)).toBe(true);
		expect(dbState.reports.size).toBe(2);
	});

	it('throws 404 for an unknown skeleton id and creates no report', async () => {
		await expectAppError(
			instantiateReport('01970000-0000-7000-8000-00000000dead', TEST_SCOPE),
			404
		);
		expect(dbState.reports.size).toBe(0);
	});
});
