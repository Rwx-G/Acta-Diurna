import { createHash } from 'node:crypto';
import { Column, Param, type SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiTokenRow } from '../db/schema';
import {
	authenticateApiToken,
	createApiToken,
	listApiTokens,
	PAT_PREFIX,
	revokeApiToken
} from './api-tokens';

// Hash-keyed store mirroring the 1.4 sessions / 3.2 shares mocks: rows filtered by
// decoding drizzle eq() chunks, so a regression querying by raw token (or the
// wrong column) misses and fails. `update().set().where()` mutates the matched
// rows in place; the last-used stamp resolves a thenable.
const dbState = vi.hoisted(() => ({
	rows: [] as Record<string, unknown>[],
	inserted: [] as Record<string, unknown>[],
	whereFilters: [] as { column: string; value: unknown }[],
	updates: [] as Record<string, unknown>[],
	listLimits: [] as number[]
}));

function decodeEqFilter(filter: unknown): { column: string; value: unknown } {
	const chunks = (filter as { queryChunks: unknown[] }).queryChunks;
	const column = chunks.find((chunk): chunk is Column => chunk instanceof Column);
	const param = chunks.find((chunk): chunk is Param => chunk instanceof Param);
	if (!column || !param) throw new Error('mock only supports eq(column, value) filters');
	return { column: column.name, value: param.value };
}

function matchRows(decoded: { column: string; value: unknown }): Record<string, unknown>[] {
	return dbState.rows.filter((row) => {
		if (decoded.column === 'token_hash') return row.tokenHash === decoded.value;
		if (decoded.column === 'id') return row.id === decoded.value;
		return false;
	});
}

vi.mock('$lib/server/mode', () => ({
	operatingMode: () => 'single',
	isMultiAuthor: () => false
}));

const TEST_SCOPE = { authorId: '01970000-0000-7000-8000-0000000000aa' };

vi.mock('$lib/server/db/client', () => ({
	getDb: () => ({
		insert: () => ({
			values: (row: Record<string, unknown>) => {
				dbState.inserted.push(row);
				dbState.rows.push(row);
				return Promise.resolve();
			}
		}),
		select: () => {
			// listApiTokens calls select().from().where(ownerFilter).orderBy().limit().
			// In single mode `ownerFilter` is `undefined` (the no-op owner predicate),
			// so the list path runs all rows up to the cap regardless of the where.
			const listChain = {
				orderBy: () => ({
					limit: (count: number) => {
						dbState.listLimits.push(count);
						return Promise.resolve(dbState.rows.slice(0, count));
					}
				})
			};
			return {
				from: () => ({
					$dynamic: () => listChain,
					where: (filter: SQL | undefined) => {
						if (filter === undefined) return listChain;
						const decoded = decodeEqFilter(filter);
						dbState.whereFilters.push(decoded);
						const matched = matchRows(decoded);
						return {
							limit: () => Promise.resolve(matched.slice(0, 1)),
							orderBy: () => Promise.resolve(matched)
						};
					},
					...listChain
				})
			};
		},
		update: () => ({
			set: (patch: Record<string, unknown>) => ({
				where: (filter: SQL) => {
					// `and(eq(id), isNull(revokedAt))` for revoke, `eq(id)` for last-used.
					// Decode the eq(id) chunk wherever it sits.
					const decoded = decodeEqFilterLoose(filter);
					const matched = decoded ? matchRows(decoded) : [];
					const applicable =
						decoded && decoded.column === 'id' && patch.revokedAt !== undefined
							? matched.filter((row) => row.revokedAt === null || row.revokedAt === undefined)
							: matched;
					for (const row of applicable) Object.assign(row, patch);
					dbState.updates.push({ patch, matched: applicable.length });
					const thenable = {
						then: (resolve: (v: unknown) => void) => resolve(undefined),
						catch: () => thenable
					};
					return thenable;
				}
			})
		})
	})
}));

// The revoke where is `and(eq(id), isNull(revokedAt))`: a top-level eq decode
// throws because the AND wrapper has no Column/Param at its own level. Walk the
// chunks recursively to find the first eq(id).
function decodeEqFilterLoose(filter: unknown): { column: string; value: unknown } | null {
	try {
		return decodeEqFilter(filter);
	} catch {
		const chunks = (filter as { queryChunks?: unknown[] }).queryChunks ?? [];
		for (const chunk of chunks) {
			const nested = decodeEqFilterLoose(chunk);
			if (nested) return nested;
		}
		return null;
	}
}

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

function seedToken(overrides: Partial<ApiTokenRow> = {}): ApiTokenRow {
	const row: ApiTokenRow = {
		id: '0197b300-0000-7000-8000-000000000001',
		name: 'seeded',
		tokenHash: sha256('seeded-token'),
		displayFragment: 'oken',
		ownerId: null,
		createdAt: new Date('2026-06-12T10:00:00Z'),
		lastUsedAt: null,
		revokedAt: null,
		...overrides
	};
	dbState.rows.push(row);
	return row;
}

beforeEach(() => {
	dbState.rows = [];
	dbState.inserted = [];
	dbState.whereFilters = [];
	dbState.updates = [];
	dbState.listLimits = [];
});

describe('createApiToken', () => {
	it('returns a prefixed raw token and persists only its hash', async () => {
		const { token, summary } = await createApiToken('CI deploy', TEST_SCOPE);

		// acta_pat_ prefix + 256-bit base64url body (43 chars).
		expect(token).toMatch(/^acta_pat_[A-Za-z0-9_-]{43}$/);
		expect(token.startsWith(PAT_PREFIX)).toBe(true);

		expect(dbState.inserted).toHaveLength(1);
		const row = dbState.inserted[0];
		expect(row.tokenHash).toBe(sha256(token));
		expect(row.tokenHash).not.toBe(token);
		// The raw token is on NO persisted column.
		expect(Object.values(row)).not.toContain(token);
		// And it never leaks into the returned summary.
		expect(JSON.stringify(summary)).not.toContain(token);
	});

	it('stores a non-secret display fragment (the last 4 raw chars)', async () => {
		const { token, summary } = await createApiToken('CI', TEST_SCOPE);
		expect(summary.displayFragment).toBe(token.slice(-4));
		expect(dbState.inserted[0].displayFragment).toBe(token.slice(-4));
		// The fragment alone is far too short to be the token.
		expect(token).not.toBe(summary.displayFragment);
	});

	it('has >= 128-bit entropy (256-bit body) and is unique across calls', async () => {
		const a = await createApiToken('a', TEST_SCOPE);
		const b = await createApiToken('b', TEST_SCOPE);
		expect(a.token).not.toBe(b.token);
		// 43 base64url chars decode to 32 bytes = 256 bits.
		const body = a.token.slice(PAT_PREFIX.length);
		expect(Buffer.from(body, 'base64url')).toHaveLength(32);
	});

	it('assigns a UUIDv7 id and active status', async () => {
		const { summary } = await createApiToken('CI', TEST_SCOPE);
		expect(summary.id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
		);
		expect(summary.status).toBe('active');
		expect(summary.lastUsedAt).toBeNull();
		expect(summary.revokedAt).toBeNull();
	});
});

describe('listApiTokens', () => {
	it('projects each token in a page envelope, never exposing the raw token or hash', async () => {
		const { token } = await createApiToken('first', TEST_SCOPE);
		seedToken({ tokenHash: sha256('second'), name: 'second' });

		const page = await listApiTokens(TEST_SCOPE);

		expect(page.items.length).toBe(2);
		// Two rows under the default page size: the last page, no further cursor.
		expect(page.nextCursor).toBeNull();
		const serialized = JSON.stringify(page.items);
		expect(serialized).not.toContain(token);
		expect(serialized).not.toContain('tokenHash');
		for (const summary of page.items) {
			expect(summary).not.toHaveProperty('tokenHash');
			expect(summary).toHaveProperty('status');
			expect(summary).toHaveProperty('displayFragment');
		}
	});

	it('returns an empty page when there are no tokens', async () => {
		await expect(listApiTokens(TEST_SCOPE)).resolves.toEqual({ items: [], nextCursor: null });
	});

	it('marks a revoked token revoked', async () => {
		seedToken({ revokedAt: new Date() });
		const {
			items: [summary]
		} = await listApiTokens(TEST_SCOPE);
		expect(summary.status).toBe('revoked');
	});

	it('bounds the query: it fetches one more than the page size to detect a further page', async () => {
		seedToken();
		await listApiTokens(TEST_SCOPE, { limit: 100 });
		// limit + 1, so the list signals a further page rather than dropping rows.
		expect(dbState.listLimits).toEqual([101]);
	});
});

describe('revokeApiToken', () => {
	it('sets revoked_at on a live token', async () => {
		const row = seedToken({ revokedAt: null });
		await revokeApiToken(row.id, TEST_SCOPE);
		expect(row.revokedAt).toBeInstanceOf(Date);
	});

	it('is idempotent: revoking an already-revoked token preserves the original instant', async () => {
		const original = new Date('2026-06-01T00:00:00Z');
		const row = seedToken({ revokedAt: original });
		await revokeApiToken(row.id, TEST_SCOPE);
		expect(row.revokedAt).toEqual(original);
	});

	it('is a silent no-op for an unknown id', async () => {
		await expect(revokeApiToken('does-not-exist', TEST_SCOPE)).resolves.toBeUndefined();
	});
});

describe('authenticateApiToken', () => {
	it('resolves a live token by hashing the raw bearer (never a raw match)', async () => {
		const { token, summary } = await createApiToken('CI', TEST_SCOPE);

		const identity = await authenticateApiToken(token);

		expect(identity).toEqual({ tokenId: summary.id, ownerId: TEST_SCOPE.authorId });
		// The lookup filtered on token_hash = sha256(token), not the raw token.
		expect(dbState.whereFilters).toContainEqual({ column: 'token_hash', value: sha256(token) });
	});

	it('rejects a token without the acta_pat_ prefix before any DB lookup', async () => {
		seedToken({ tokenHash: sha256('no-prefix-token') });

		const identity = await authenticateApiToken('no-prefix-token');

		expect(identity).toBeNull();
		// No lookup happened: the prefix check short-circuits.
		expect(dbState.whereFilters).toHaveLength(0);
	});

	it('returns null for an unknown token', async () => {
		await expect(authenticateApiToken(`${PAT_PREFIX}unknown`)).resolves.toBeNull();
	});

	it('returns null for a revoked token', async () => {
		const { token } = await createApiToken('CI', TEST_SCOPE);
		const row = dbState.rows[0] as ApiTokenRow;
		row.revokedAt = new Date();

		await expect(authenticateApiToken(token)).resolves.toBeNull();
	});

	it('stamps last_used_at on a successful authentication', async () => {
		const { token } = await createApiToken('CI', TEST_SCOPE);
		const row = dbState.rows[0] as ApiTokenRow;
		expect(row.lastUsedAt).toBeNull();

		await authenticateApiToken(token);

		// The fire-and-forget stamp resolves synchronously in the mock.
		await Promise.resolve();
		expect(row.lastUsedAt).toBeInstanceOf(Date);
	});

	it('never authenticates a row seeded under a raw (unhashed) token', async () => {
		seedToken({ tokenHash: `${PAT_PREFIX}raw` });
		await expect(authenticateApiToken(`${PAT_PREFIX}raw`)).resolves.toBeNull();
	});
});
