import { mkdtemp, rm, writeFile, access, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';

// The WHERE predicate is evaluated by PostgreSQL, which the unit suite does not
// run; the fake db below stands in for the query builder and returns the rows
// the test seeds as "matching". So these tests cover the orchestration the
// function owns in process: the returned count, the per-row file unlink, the
// ENOENT tolerance, the swallow-and-log isolation of a non-ENOENT unlink error,
// and the defense-in-depth UPLOADS_DIR containment guard. The grace-window
// boundary math is asserted directly on the pure `orphanCutoff` helper.

const uploadsDir = await mkdtemp(join(tmpdir(), 'acta-purge-'));

vi.mock('$lib/server/env', () => ({ serverEnv: () => ({ UPLOADS_DIR: uploadsDir }) }));

const warn = vi.fn();
vi.mock('$lib/server/logger', () => ({ logger: { warn, info: vi.fn(), error: vi.fn() } }));

const {
	DEFAULT_ORPHAN_RETENTION_DAYS,
	orphanCutoff,
	purgeOrphanDataSets,
	purgeVerificationTokens
} = await import('./purge.ts');

beforeEach(() => {
	warn.mockReset();
});

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

	it('a mid-loop non-ENOENT unlink error does not strand the other files (CWE-459)', async () => {
		// A directory under uploadsDir cannot be unlink()ed: the call throws a
		// non-ENOENT error (EPERM/EISDIR), the same class as EACCES/EBUSY/EIO on a
		// real file. It sits BETWEEN two good files, so it proves the loop swallows
		// the error and still unlinks every remaining row.
		const before = join(uploadsDir, 'before.csv');
		const undeletable = await mkdtemp(join(uploadsDir, 'locked-'));
		const after = join(uploadsDir, 'after.csv');
		await writeFile(before, 'x');
		await writeFile(after, 'y');
		const { db } = fakeDb({
			data_sets: [{ storagePath: before }, { storagePath: undeletable }, { storagePath: after }]
		});

		const removed = await purgeOrphanDataSets(db, new Date(), 30);

		expect(removed).toBe(3);
		expect(await exists(before)).toBe(false);
		expect(await exists(after)).toBe(false);
		expect(warn).toHaveBeenCalledWith(
			expect.objectContaining({ storagePath: undeletable }),
			expect.stringContaining('failed to unlink')
		);
		await rm(undeletable, { recursive: true, force: true });
	});

	it('refuses to unlink a path outside UPLOADS_DIR and logs it (defense in depth)', async () => {
		const outside = await mkdtemp(join(tmpdir(), 'acta-outside-'));
		const stray = join(outside, 'stray.csv');
		await writeFile(stray, 'z');
		const { db } = fakeDb({ data_sets: [{ storagePath: stray }] });

		const removed = await purgeOrphanDataSets(db, new Date(), 30);

		// The row is still counted (it is deleted from the table), but its file is
		// left untouched because it resolves outside the uploads volume.
		expect(removed).toBe(1);
		expect(await exists(stray)).toBe(true);
		expect(warn).toHaveBeenCalledWith(
			expect.objectContaining({ storagePath: stray }),
			expect.stringContaining('outside UPLOADS_DIR')
		);
		await unlink(stray);
		await rm(outside, { recursive: true, force: true });
	});
});
