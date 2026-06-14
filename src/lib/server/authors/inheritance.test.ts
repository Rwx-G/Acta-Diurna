import { Column, Param, isNull } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	backfillReportSeries,
	inheritLegacyOwnership,
	purgeStaleNullAuthorSessions
} from './inheritance';

// The implicit author resolves to a fixed id; inheritance backfills every
// owner-less row to it. The db mock records UPDATE ... SET owner_id WHERE
// owner_id IS NULL and only "touches" rows whose ownerId is currently null, so
// the test asserts the backfill targets exactly the legacy rows and is
// idempotent on a second run.
const IMPLICIT_AUTHOR_ID = '01970000-0000-7000-8000-0000000000aa';

vi.mock('./identity', () => ({
	ensureImplicitAuthor: () => Promise.resolve(IMPLICIT_AUTHOR_ID)
}));

vi.mock('$lib/server/logger', () => ({ logger: { info: vi.fn() } }));

// The operating mode is toggled per test (single vs multi) so the session-purge
// branch is exercised both ways: a no-op in single, a real delete in multi.
const modeState = vi.hoisted(() => ({ multi: false }));

vi.mock('$lib/server/mode', () => ({
	operatingMode: () => (modeState.multi ? 'multi' : 'single'),
	isMultiAuthor: () => modeState.multi
}));

const dbState = vi.hoisted(() => ({
	reports: [] as { id: string; ownerId: string | null; seriesId?: string | null }[],
	dataSets: [] as { id: string; ownerId: string | null }[],
	skeletons: [] as { id: string; ownerId: string | null }[],
	apiTokens: [] as { id: string; ownerId: string | null }[],
	sessions: [] as { id: string; realm: string; authorId: string | null }[],
	series: [] as { id: string; ownerId: string | null }[]
}));

vi.mock('$lib/server/db/client', () => {
	// Each update()/delete() call carries the target table; map it to the right array
	// by the drizzle table's SQL name, read off the table symbol metadata.
	function nameOf(table: unknown): string {
		const sym = Object.getOwnPropertySymbols(table as object).find(
			(s) => s.toString() === 'Symbol(drizzle:Name)'
		);
		return sym ? String((table as Record<symbol, unknown>)[sym]) : '';
	}
	function rowsFor(name: string): { id: string; ownerId: string | null }[] {
		if (name === 'reports') return dbState.reports;
		if (name === 'data_sets') return dbState.dataSets;
		if (name === 'skeletons') return dbState.skeletons;
		if (name === 'api_tokens') return dbState.apiTokens;
		return [];
	}
	// Decode a bare eq(column, value) WHERE so the series backfill's per-row
	// `update(reports).where(eq(id, x))` can be applied to the matching row.
	function decodeEqId(filter: unknown): string | null {
		const chunks = (filter as { queryChunks?: unknown[] }).queryChunks ?? [];
		const column = chunks.find((c): c is Column => c instanceof Column);
		const param = chunks.find((c): c is Param => c instanceof Param);
		return column?.name === 'id' && param ? String(param.value) : null;
	}
	return {
		getDb: () => ({
			select: () => ({
				// backfillReportSeries reads the series-less reports (series_id IS NULL);
				// the mock keys off the live seriesId, so it returns exactly the orphans.
				from: (table: unknown) => ({
					where: () => {
						if (nameOf(table) !== 'reports') return Promise.resolve([]);
						const orphans = dbState.reports.filter(
							(row) => row.seriesId === null || row.seriesId === undefined
						);
						return Promise.resolve(orphans.map((row) => ({ id: row.id, ownerId: row.ownerId })));
					}
				})
			}),
			insert: (table: unknown) => ({
				// The series backfill batches a multi-row insert (one row per orphan);
				// createSeries paths pass a single row. Accept both shapes.
				values: (
					rows: { id: string; ownerId: string | null } | { id: string; ownerId: string | null }[]
				) => {
					if (nameOf(table) === 'report_series') {
						for (const row of Array.isArray(rows) ? rows : [rows]) dbState.series.push(row);
					}
					return Promise.resolve();
				}
			}),
			update: (table: unknown) => ({
				set: (set: { ownerId?: string; seriesId?: string }) => ({
					// The series backfill awaits update(reports).where(eq(id, x)) directly
					// (no .returning()); the ownership backfill calls .returning() on the
					// IS NULL sweep. Return a thenable that ALSO carries .returning().
					where: (filter: unknown) => {
						const apply = () => {
							const rows = rowsFor(nameOf(table));
							if (set.seriesId !== undefined) {
								const id = decodeEqId(filter);
								const touched = rows.filter((row) => row.id === id);
								for (const row of touched) (row as { seriesId?: string }).seriesId = set.seriesId;
								return touched;
							}
							const touched = rows.filter((row) => row.ownerId === null);
							for (const row of touched) row.ownerId = set.ownerId!;
							return touched;
						};
						const result = apply();
						const promise = Promise.resolve({ rowCount: result.length });
						return Object.assign(promise, {
							returning: () => Promise.resolve(result.map((row) => ({ id: row.id })))
						});
					}
				})
			}),
			delete: (table: unknown) => ({
				where: () => ({
					// purgeStaleNullAuthorSessions deletes realm='author' AND author_id IS
					// NULL; the mock applies exactly that predicate and returns the removed ids.
					returning: () => {
						if (nameOf(table) !== 'sessions') return Promise.resolve([]);
						const removed = dbState.sessions.filter(
							(s) => s.realm === 'author' && s.authorId === null
						);
						dbState.sessions = dbState.sessions.filter((s) => !removed.includes(s));
						return Promise.resolve(removed.map((s) => ({ id: s.id })));
					}
				})
			})
		})
	};
});

// isNull is referenced by the service; the mock ignores the where expression and
// keys off the live ownerId, so importing it here only proves the import resolves.
void isNull;

beforeEach(() => {
	modeState.multi = false;
	dbState.reports = [
		{ id: 'r-legacy-1', ownerId: null },
		{ id: 'r-legacy-2', ownerId: null },
		{ id: 'r-owned', ownerId: 'someone-else' }
	];
	dbState.dataSets = [{ id: 'd-legacy', ownerId: null }];
	dbState.skeletons = [{ id: 's-legacy', ownerId: null }];
	dbState.apiTokens = [{ id: 't-legacy', ownerId: null }];
	dbState.sessions = [];
	dbState.series = [];
});

describe('inheritLegacyOwnership', () => {
	it('assigns every owner-less report, data set, skeleton, and token to the implicit author', async () => {
		const counts = await inheritLegacyOwnership();

		expect(counts.authorId).toBe(IMPLICIT_AUTHOR_ID);
		expect(counts.reports).toBe(2);
		expect(counts.dataSets).toBe(1);
		expect(counts.skeletons).toBe(1);
		expect(counts.apiTokens).toBe(1);
		// The legacy rows now carry the implicit author; the already-owned row is untouched.
		expect(dbState.reports.find((r) => r.id === 'r-legacy-1')?.ownerId).toBe(IMPLICIT_AUTHOR_ID);
		expect(dbState.reports.find((r) => r.id === 'r-owned')?.ownerId).toBe('someone-else');
		expect(dbState.skeletons.find((s) => s.id === 's-legacy')?.ownerId).toBe(IMPLICIT_AUTHOR_ID);
	});

	it('is idempotent: a second run finds no null owners and inherits nothing', async () => {
		await inheritLegacyOwnership();
		const second = await inheritLegacyOwnership();

		expect(second.reports).toBe(0);
		expect(second.dataSets).toBe(0);
		expect(second.skeletons).toBe(0);
		expect(second.apiTokens).toBe(0);
	});
});

describe('backfillReportSeries (story 9.1)', () => {
	beforeEach(() => {
		// Every report carries an owner by the time the series backfill runs (it runs
		// after inheritLegacyOwnership), but none carries a series yet.
		dbState.reports = [
			{ id: 'r-1', ownerId: 'author-a', seriesId: null },
			{ id: 'r-2', ownerId: 'author-b', seriesId: null }
		];
	});

	it('gives every series-less report its own fresh series carrying the report owner', async () => {
		const count = await backfillReportSeries();

		expect(count).toBe(2);
		// Two DISTINCT series were minted (a series groups a lineage, not all reports).
		expect(dbState.series).toHaveLength(2);
		expect(dbState.series[0].id).not.toBe(dbState.series[1].id);
		// Each report now points at a series, and that series carries the report's owner.
		const r1 = dbState.reports.find((r) => r.id === 'r-1')!;
		const r2 = dbState.reports.find((r) => r.id === 'r-2')!;
		expect(r1.seriesId).toBeTruthy();
		expect(r2.seriesId).toBeTruthy();
		expect(r1.seriesId).not.toBe(r2.seriesId);
		const s1 = dbState.series.find((s) => s.id === r1.seriesId)!;
		const s2 = dbState.series.find((s) => s.id === r2.seriesId)!;
		expect(s1.ownerId).toBe('author-a');
		expect(s2.ownerId).toBe('author-b');
	});

	it('is idempotent: a second run finds no series-less report and mints nothing', async () => {
		await backfillReportSeries();
		const second = await backfillReportSeries();

		expect(second).toBe(0);
		expect(dbState.series).toHaveLength(2);
	});
});

describe('purgeStaleNullAuthorSessions', () => {
	function seedSessions(): void {
		dbState.sessions = [
			{ id: 'author-null', realm: 'author', authorId: null },
			{ id: 'author-real', realm: 'author', authorId: 'a-real-author' },
			{ id: 'reader-null', realm: 'reader', authorId: null }
		];
	}

	it('removes only null-author AUTHOR sessions in multi mode, leaving the rest', async () => {
		modeState.multi = true;
		seedSessions();

		const purged = await purgeStaleNullAuthorSessions();

		expect(purged).toBe(1);
		const ids = dbState.sessions.map((s) => s.id).sort();
		// The null-author author session is gone; the real-author and reader sessions remain.
		expect(ids).toEqual(['author-real', 'reader-null']);
	});

	it('is idempotent in multi mode: a second run finds nothing to purge', async () => {
		modeState.multi = true;
		seedSessions();

		await purgeStaleNullAuthorSessions();
		const second = await purgeStaleNullAuthorSessions();

		expect(second).toBe(0);
	});

	it('is a no-op in single mode: a null-author author session is the legitimate shape', async () => {
		modeState.multi = false;
		seedSessions();

		const purged = await purgeStaleNullAuthorSessions();

		expect(purged).toBe(0);
		expect(dbState.sessions).toHaveLength(3);
	});
});
