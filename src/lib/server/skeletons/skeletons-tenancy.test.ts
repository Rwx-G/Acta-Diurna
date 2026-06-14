import { Column, Param, type SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBrick } from '$lib/bricks';
import { AppError } from '$lib/server/problem';
import type { AuthorScope } from '$lib/server/authors';
import {
	deleteSkeleton,
	getSkeleton,
	instantiateReport,
	listSkeletons,
	saveSkeleton
} from './skeletons.ts';

// The load-bearing skeleton-tenancy proof (story 8.2 IDOR fix): in MULTI mode the
// owner predicate isolates authors. This runs the REAL skeleton service with the
// mode forced to multi and an owner-aware db mock against two distinct scopes -
// author B's skeletons are invisible to author A's list, a direct cross-author id
// is the SAME 404 (no existence oracle), and the same name is usable by both
// authors (the (owner_id, name) unique index, not a global name).
//
// The single-mode parity is proved in skeletons.test.ts (mode forced to single,
// unchanged behavior).
vi.mock('$lib/server/mode', () => ({
	operatingMode: () => 'multi',
	isMultiAuthor: () => true
}));

const AUTHOR_A: AuthorScope = { authorId: '01970000-0000-7000-8000-00000000000a' };
const AUTHOR_B: AuthorScope = { authorId: '01970000-0000-7000-8000-00000000000b' };

const UNIQUE_VIOLATION = '23505';

function uniqueViolation(): Error & { code: string } {
	return Object.assign(new Error('duplicate key value violates unique constraint'), {
		code: UNIQUE_VIOLATION
	});
}

// An owner-aware store mirroring the tenancy mock used for reports: every read
// decodes the WHERE chunks (id and/or owner_id) so a row matches only when every
// decoded filter matches, exercising the real multi-mode predicate the service
// ANDs in. The skeletons insert enforces the (owner_id, name) unique index.
const skeletonStore = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>() }));
const reportStore = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>() }));
// instantiateReport mints a report_series row (story 9.1); tracked apart so it
// never lands in the report store.
const seriesStore = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

function decodeEqFilters(filter: unknown): { column: string; value: unknown }[] {
	const chunks = (filter as { queryChunks?: unknown[] }).queryChunks ?? [];
	const directColumn = chunks.find((chunk): chunk is Column => chunk instanceof Column);
	if (directColumn) {
		const param = chunks.find((chunk): chunk is Param => chunk instanceof Param);
		return [{ column: directColumn.name, value: param?.value }];
	}
	return chunks.flatMap((chunk) =>
		chunk && typeof chunk === 'object' && 'queryChunks' in chunk ? decodeEqFilters(chunk) : []
	);
}

function matches(
	store: Map<string, Record<string, unknown>>,
	filters: { column: string; value: unknown }[]
): Record<string, unknown>[] {
	return [...store.values()].filter((row) =>
		filters.every((filter) => {
			if (filter.column === 'id') return row.id === filter.value;
			if (filter.column === 'owner_id') return row.ownerId === filter.value;
			return true;
		})
	);
}

vi.mock('$lib/server/db/client', () => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const db: any = {
		// instantiateReport -> createReportWithDocument runs its series + report
		// writes in one transaction; model it as a pass-through over the same builder.
		transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(db),
		insert: () => ({
			values: (row: Record<string, unknown>) => {
				// A document column distinguishes the tables; the skeleton insert enforces
				// (owner_id, name) uniqueness, the report insert does not, and a series row
				// (id + ownerId only, no document) is tracked separately so it never
				// pollutes the report store.
				if ('schemaVersion' in row && !('status' in row)) {
					const clash = [...skeletonStore.rows.values()].some(
						(existing) => existing.name === row.name && existing.ownerId === row.ownerId
					);
					if (clash) return Promise.reject(uniqueViolation());
					skeletonStore.rows.set(String(row.id), row);
				} else if ('document' in row) {
					reportStore.rows.set(String(row.id), row);
				} else {
					seriesStore.rows.push(row);
				}
				return Promise.resolve();
			}
		}),
		select: () => ({
			from: () => ({
				// getSkeleton -> where(...).limit(1); listSkeletons (multi) ->
				// $dynamic().where(owner).orderBy(...) through the shared owner-scope
				// helper. A bare orderBy (single-mode list) is not reached here.
				$dynamic: () => ({
					where: (filter: SQL) => {
						const filtered = matches(skeletonStore.rows, decodeEqFilters(filter));
						return {
							orderBy: () => Promise.resolve(filtered),
							limit: (count: number) => Promise.resolve(filtered.slice(0, count))
						};
					},
					orderBy: () => Promise.resolve([...skeletonStore.rows.values()]),
					limit: (count: number) =>
						Promise.resolve([...skeletonStore.rows.values()].slice(0, count))
				}),
				where: (filter: SQL) => {
					const filtered = matches(skeletonStore.rows, decodeEqFilters(filter));
					return {
						limit: (count: number) => Promise.resolve(filtered.slice(0, count)),
						orderBy: () => Promise.resolve(filtered)
					};
				},
				orderBy: () => Promise.resolve([...skeletonStore.rows.values()])
			})
		}),
		delete: () => ({
			where: (filter: SQL) => {
				for (const row of matches(skeletonStore.rows, decodeEqFilters(filter))) {
					skeletonStore.rows.delete(String(row.id));
				}
				return Promise.resolve();
			}
		})
	};
	return { getDb: () => db };
});

function draftFrom(title: string, ...brickIds: string[]) {
	return {
		version: 1 as const,
		title,
		sections: brickIds.map((id) => getBrick(id)!.factory())
	};
}

async function expectNotFound(promise: Promise<unknown>): Promise<void> {
	await expect(promise).rejects.toMatchObject({ status: 404 });
	await promise.catch((error) => expect(error).toBeInstanceOf(AppError));
}

beforeEach(() => {
	skeletonStore.rows.clear();
	reportStore.rows.clear();
	seriesStore.rows = [];
});

describe('skeleton tenancy (multi mode)', () => {
	it("does not list another author's skeleton", async () => {
		await saveSkeleton(draftFrom('A skeleton', 'cover'), AUTHOR_A);
		await saveSkeleton(draftFrom('B skeleton', 'cover'), AUTHOR_B);

		const list = await listSkeletons(AUTHOR_A);

		expect(list).toHaveLength(1);
		expect(list[0].name).toBe('A skeleton');
	});

	it("returns the same 404 on a direct read of another author's skeleton (no existence oracle)", async () => {
		const b = await saveSkeleton(draftFrom('B skeleton', 'cover'), AUTHOR_B);

		await expectNotFound(getSkeleton(b.id, AUTHOR_A));
		await expectNotFound(getSkeleton('01970000-0000-7000-8000-00000000dead', AUTHOR_A));
		const own = await getSkeleton(b.id, AUTHOR_B);
		expect(own.name).toBe('B skeleton');
	});

	it('refuses a cross-author delete with the same 404 and leaves the row intact', async () => {
		const b = await saveSkeleton(draftFrom('B skeleton', 'cover'), AUTHOR_B);

		await expectNotFound(deleteSkeleton(b.id, AUTHOR_A));
		expect(skeletonStore.rows.has(b.id)).toBe(true);
	});

	it("refuses to instantiate another author's skeleton with the same 404 and creates no report", async () => {
		const b = await saveSkeleton(draftFrom('B skeleton', 'cover'), AUTHOR_B);

		await expectNotFound(instantiateReport(b.id, AUTHOR_A));
		expect(reportStore.rows.size).toBe(0);
	});

	it('lets two authors use the same skeleton name (no global 409)', async () => {
		await saveSkeleton(draftFrom('Weekly ops', 'cover'), AUTHOR_A);

		await expect(saveSkeleton(draftFrom('Weekly ops', 'cover'), AUTHOR_B)).resolves.toMatchObject({
			name: 'Weekly ops'
		});
		// A second save of the same name FOR THE SAME author still trips the 409.
		await expect(saveSkeleton(draftFrom('Weekly ops', 'cover'), AUTHOR_A)).rejects.toMatchObject({
			status: 409
		});
	});

	it('stamps a new skeleton with the creating author as owner', async () => {
		const saved = await saveSkeleton(draftFrom('Fresh', 'cover'), AUTHOR_A);
		expect(skeletonStore.rows.get(saved.id)?.ownerId).toBe(AUTHOR_A.authorId);
	});
});
