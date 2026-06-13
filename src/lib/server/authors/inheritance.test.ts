import { isNull } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inheritLegacyOwnership } from './inheritance';

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

const dbState = vi.hoisted(() => ({
	reports: [] as { id: string; ownerId: string | null }[],
	dataSets: [] as { id: string; ownerId: string | null }[],
	apiTokens: [] as { id: string; ownerId: string | null }[]
}));

vi.mock('$lib/server/db/client', () => {
	// Each update() call carries the target table; map it to the right array by the
	// drizzle table's SQL name, read off the table symbol metadata.
	function nameOf(table: unknown): string {
		const sym = Object.getOwnPropertySymbols(table as object).find(
			(s) => s.toString() === 'Symbol(drizzle:Name)'
		);
		return sym ? String((table as Record<symbol, unknown>)[sym]) : '';
	}
	function rowsFor(name: string): { id: string; ownerId: string | null }[] {
		if (name === 'reports') return dbState.reports;
		if (name === 'data_sets') return dbState.dataSets;
		if (name === 'api_tokens') return dbState.apiTokens;
		return [];
	}
	return {
		getDb: () => ({
			update: (table: unknown) => ({
				set: (set: { ownerId: string }) => ({
					where: () => ({
						// inheritLegacyOwnership filters on owner_id IS NULL; the mock applies
						// the set to exactly the currently-null rows and returns them.
						returning: () => {
							const rows = rowsFor(nameOf(table));
							const touched = rows.filter((row) => row.ownerId === null);
							for (const row of touched) row.ownerId = set.ownerId;
							return Promise.resolve(touched.map((row) => ({ id: row.id })));
						}
					})
				})
			})
		})
	};
});

// isNull is referenced by the service; the mock ignores the where expression and
// keys off the live ownerId, so importing it here only proves the import resolves.
void isNull;

beforeEach(() => {
	dbState.reports = [
		{ id: 'r-legacy-1', ownerId: null },
		{ id: 'r-legacy-2', ownerId: null },
		{ id: 'r-owned', ownerId: 'someone-else' }
	];
	dbState.dataSets = [{ id: 'd-legacy', ownerId: null }];
	dbState.apiTokens = [{ id: 't-legacy', ownerId: null }];
});

describe('inheritLegacyOwnership', () => {
	it('assigns every owner-less report, data set, and token to the implicit author', async () => {
		const counts = await inheritLegacyOwnership();

		expect(counts.authorId).toBe(IMPLICIT_AUTHOR_ID);
		expect(counts.reports).toBe(2);
		expect(counts.dataSets).toBe(1);
		expect(counts.apiTokens).toBe(1);
		// The legacy rows now carry the implicit author; the already-owned row is untouched.
		expect(dbState.reports.find((r) => r.id === 'r-legacy-1')?.ownerId).toBe(IMPLICIT_AUTHOR_ID);
		expect(dbState.reports.find((r) => r.id === 'r-owned')?.ownerId).toBe('someone-else');
	});

	it('is idempotent: a second run finds no null owners and inherits nothing', async () => {
		await inheritLegacyOwnership();
		const second = await inheritLegacyOwnership();

		expect(second.reports).toBe(0);
		expect(second.dataSets).toBe(0);
		expect(second.apiTokens).toBe(0);
	});
});
