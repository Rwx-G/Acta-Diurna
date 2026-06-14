import { Column, Param, type SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `revokeShare` (story 3.5, FR20): flips `revoked_at` and sweeps live reader
// sessions, idempotently. The db mock models an UPDATE guarded by
// `WHERE id = ? AND revoked_at IS NULL` so a second revoke is a verified no-op
// (zero rows touched, the original instant preserved). The session sweep is
// mocked to assert it runs on every call (defense in depth).

const dbState = vi.hoisted(() => ({
	rows: [] as { id: string; revokedAt: Date | null }[],
	updateCalls: [] as { id: string; revokedAt: Date | null; matched: number }[]
}));

const sweep = vi.hoisted(() => vi.fn());

/** Flattens a (possibly nested) drizzle SQL filter into its leaf chunks. */
function flattenChunks(filter: unknown): unknown[] {
	const chunks = (filter as { queryChunks: unknown[] }).queryChunks;
	const flat: unknown[] = [];
	const walk = (node: unknown): void => {
		if (node && typeof node === 'object' && 'queryChunks' in node) {
			for (const c of (node as { queryChunks: unknown[] }).queryChunks) walk(c);
		} else {
			flat.push(node);
		}
	};
	for (const chunk of chunks) walk(chunk);
	return flat;
}

/** The first `eq(column, value)` param value in a filter - the share id both filters carry. */
function decodeShareId(filter: unknown): string {
	const idParam = flattenChunks(filter).find((node): node is Param => node instanceof Param);
	if (!idParam) throw new Error('mock expected an eq(id, value) in the filter');
	return idParam.value as string;
}

// Decode `and(eq(id, value), isNull(revoked_at))` into the id it filters on,
// asserting the isNull(revoked_at) idempotency guard is still present.
function decodeUpdateFilter(filter: unknown): string {
	const flat = flattenChunks(filter);
	const columns = flat.filter((node): node is Column => node instanceof Column);
	// The filter must reference both `id` (the eq) and `revoked_at` (the isNull
	// guard); a regression dropping the guard would not reference revoked_at.
	expect(columns.map((c) => c.name)).toEqual(expect.arrayContaining(['id', 'revoked_at']));
	return decodeShareId(filter);
}

vi.mock('$lib/server/mode', () => ({
	operatingMode: () => 'single',
	isMultiAuthor: () => false
}));

const TEST_SCOPE = { authorId: '01970000-0000-7000-8000-0000000000aa' };

vi.mock('$lib/server/db/client', () => ({
	getDb: () => ({
		// `ownsShare` (story 8.2, E4) is now ONE guarded JOIN: shares JOIN reports
		// ON report_id, filtered on the share id (single mode: no owner predicate).
		// The mock resolves to a row only when the share id is a SEEDED row, so an
		// unknown share id misses the JOIN and `ownsShare` is false - the real
		// tenancy behavior the prior simplistic always-found mock masked.
		select: () => ({
			from: () => ({
				innerJoin: () => ({
					where: (filter: SQL) => ({
						limit: () => {
							const id = decodeShareId(filter);
							const exists = dbState.rows.some((r) => r.id === id);
							return Promise.resolve(exists ? [{ id }] : []);
						}
					})
				})
			})
		}),
		update: () => ({
			set: (patch: { revokedAt: Date }) => ({
				where: (filter: SQL) => {
					const id = decodeUpdateFilter(filter);
					// The isNull(revoked_at) guard: only an as-yet unrevoked row matches.
					const matched = dbState.rows.filter((r) => r.id === id && r.revokedAt === null);
					for (const r of matched) r.revokedAt = patch.revokedAt;
					dbState.updateCalls.push({ id, revokedAt: patch.revokedAt, matched: matched.length });
					return Promise.resolve();
				}
			})
		})
	})
}));

vi.mock('$lib/server/auth/sessions', () => ({ destroyReaderSessionsForShare: sweep }));

// Unused by revokeShare but imported by the module under test; stub to leaves.
vi.mock('$lib/server/documents/reports', () => ({
	getReport: vi.fn(),
	assertShareable: vi.fn()
}));

import { revokeShare } from './shares';

const SHARE_ID = '0197b300-0000-7000-8000-000000000001';

beforeEach(() => {
	dbState.rows = [];
	dbState.updateCalls = [];
	sweep.mockReset();
	sweep.mockResolvedValue(undefined);
});

describe('revokeShare', () => {
	it('sets revoked_at and sweeps the reader sessions for the share', async () => {
		dbState.rows.push({ id: SHARE_ID, revokedAt: null });

		await revokeShare(SHARE_ID, TEST_SCOPE);

		expect(dbState.rows[0].revokedAt).toBeInstanceOf(Date);
		expect(dbState.updateCalls[0].matched).toBe(1);
		expect(sweep).toHaveBeenCalledWith(SHARE_ID);
	});

	it('is idempotent: a second revoke is a no-op that preserves the original instant', async () => {
		dbState.rows.push({ id: SHARE_ID, revokedAt: null });

		await revokeShare(SHARE_ID, TEST_SCOPE);
		const firstInstant = dbState.rows[0].revokedAt;
		await new Promise((r) => setTimeout(r, 2));
		await revokeShare(SHARE_ID, TEST_SCOPE);

		// The isNull guard meant the second update matched zero rows.
		expect(dbState.updateCalls[1].matched).toBe(0);
		// The original revocation instant is untouched.
		expect(dbState.rows[0].revokedAt).toBe(firstInstant);
		// The sweep still runs on every call (idempotent itself, frees any rows).
		expect(sweep).toHaveBeenCalledTimes(2);
	});

	it('is a silent no-op for an unknown share id (no update, no sweep)', async () => {
		// E4: ownership now gates via a JOIN, so an unknown share id misses the JOIN
		// and is a full no-op - neither the guarded UPDATE nor the session sweep runs.
		// This is the real tenancy behavior the prior always-found mock masked.
		await expect(
			revokeShare('00000000-0000-7000-8000-00000000ffff', TEST_SCOPE)
		).resolves.toBeUndefined();
		expect(dbState.updateCalls).toHaveLength(0);
		expect(sweep).not.toHaveBeenCalled();
	});

	it('is a silent no-op for a share the author does not own (no update, no sweep)', async () => {
		// A foreign share never appears in this author's owned set, so the JOIN gate
		// is false: no revoke, no session sweep - an author can never disrupt another
		// author's share (story 8.2 tenancy, preserved by E4's single-query gate).
		// Modeled here as a share id absent from the seeded (owned) rows.
		await expect(
			revokeShare('0197b300-0000-7000-8000-0000000000ff', TEST_SCOPE)
		).resolves.toBeUndefined();
		expect(dbState.updateCalls).toHaveLength(0);
		expect(sweep).not.toHaveBeenCalled();
	});
});
