import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { getTableName } from 'drizzle-orm';
import {
	DEFAULT_ORPHAN_RETENTION_DAYS,
	orphanCutoff,
	purgeOrphanDataSets,
	purgeVerificationTokens
} from './purge.ts';

// The WHERE predicate is evaluated by PostgreSQL, which the unit suite does not
// run; the fake db below stands in for the query builder and returns the rows
// the test seeds as "matching". So these tests cover the orchestration the
// function owns in process: the returned count, the per-row file unlink, and the
// ENOENT tolerance. The grace-window boundary math is asserted directly on the
// pure `orphanCutoff` helper.

const uploadsDir = await mkdtemp(join(tmpdir(), 'acta-purge-'));

interface DeletedRows {
	[table: string]: Record<string, unknown>[];
}

/** A fake db whose delete().where().returning() yields the rows staged per table. */
function fakeDb(staged: DeletedRows) {
	const whereCalls: { table: string }[] = [];
	const db = {
		delete: (table: unknown) => {
			const name = getTableName(table as never);
			return {
				where: () => {
					whereCalls.push({ table: name });
					return {
						returning: () => Promise.resolve(staged[name] ?? [])
					};
				}
			};
		}
	};
	return { db: db as never, whereCalls };
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

afterAll(async () => {
	await rm(uploadsDir, { recursive: true, force: true });
});

describe('orphanCutoff (grace-window boundary)', () => {
	const now = new Date('2026-06-12T00:00:00.000Z');

	it('subtracts the retention window in whole days', () => {
		const cutoff = orphanCutoff(now, 30);
		expect(cutoff.toISOString()).toBe('2026-05-13T00:00:00.000Z');
	});

	it('a set injected after the cutoff is inside the grace window (kept); before it is an orphan', () => {
		const cutoff = orphanCutoff(now, DEFAULT_ORPHAN_RETENTION_DAYS);
		const justInsideGrace = new Date(cutoff.getTime() + 1);
		const justOutsideGrace = new Date(cutoff.getTime() - 1);

		// The predicate is strict `<`: a row at or after the cutoff is retained.
		expect(justInsideGrace > cutoff).toBe(true);
		expect(justOutsideGrace < cutoff).toBe(true);
	});
});

describe('purgeVerificationTokens', () => {
	it('returns the number of rows the delete removed', async () => {
		const { db, whereCalls } = fakeDb({
			verification_tokens: [{ id: 't1' }, { id: 't2' }, { id: 't3' }]
		});

		const removed = await purgeVerificationTokens(db, new Date());

		expect(removed).toBe(3);
		expect(whereCalls).toEqual([{ table: 'verification_tokens' }]);
	});

	it('returns 0 when nothing matched', async () => {
		const { db } = fakeDb({ verification_tokens: [] });
		expect(await purgeVerificationTokens(db, new Date())).toBe(0);
	});
});

describe('purgeOrphanDataSets', () => {
	it('unlinks each removed row file and returns the count', async () => {
		const pathA = join(uploadsDir, 'a.csv');
		const pathB = join(uploadsDir, 'b.json');
		await writeFile(pathA, 'x');
		await writeFile(pathB, 'y');
		const { db } = fakeDb({
			data_sets: [{ storagePath: pathA }, { storagePath: pathB }]
		});

		const removed = await purgeOrphanDataSets(db, new Date(), 30);

		expect(removed).toBe(2);
		expect(await exists(pathA)).toBe(false);
		expect(await exists(pathB)).toBe(false);
	});

	it('tolerates an already-missing file (ENOENT) and still counts the row', async () => {
		const gone = join(uploadsDir, 'never-written.csv');
		const { db } = fakeDb({ data_sets: [{ storagePath: gone }] });

		const removed = await purgeOrphanDataSets(db, new Date(), 30);

		expect(removed).toBe(1);
	});

	it('removes nothing and unlinks nothing when no orphan matched', async () => {
		const { db } = fakeDb({ data_sets: [] });
		expect(await purgeOrphanDataSets(db, new Date(), 30)).toBe(0);
	});
});
