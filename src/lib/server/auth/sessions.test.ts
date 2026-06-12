import { createHash } from 'node:crypto';
import { Column, Param, type SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRow } from '../db/schema';
import {
	AUTHOR_SESSION_TTL_MS,
	createAuthorSession,
	destroySession,
	validateAuthorSession
} from './sessions';

// The mock store is keyed by token HASH: a regression that queries by the raw
// token (or any other column) misses the map and fails the lookup tests. The
// `eq(column, value)` filters are decoded from drizzle's SQL chunks so the
// filtered COLUMN is asserted too, not just the value.
const dbState = vi.hoisted(() => ({
	rowsByTokenHash: new Map<string, Record<string, unknown>>(),
	inserted: [] as Record<string, unknown>[],
	whereFilters: [] as { column: string; value: unknown }[],
	deleteFilters: [] as { column: string; value: unknown }[]
}));

function decodeEqFilter(filter: unknown): { column: string; value: unknown } {
	const chunks = (filter as { queryChunks: unknown[] }).queryChunks;
	const column = chunks.find((chunk): chunk is Column => chunk instanceof Column);
	const param = chunks.find((chunk): chunk is Param => chunk instanceof Param);
	if (!column || !param) throw new Error('mock only supports eq(column, value) filters');
	return { column: column.name, value: param.value };
}

vi.mock('$lib/server/db/client', () => ({
	getDb: () => ({
		insert: () => ({
			values: (row: Record<string, unknown>) => {
				dbState.inserted.push(row);
				return Promise.resolve();
			}
		}),
		select: () => ({
			from: () => ({
				where: (filter: SQL) => {
					const decoded = decodeEqFilter(filter);
					dbState.whereFilters.push(decoded);
					return {
						limit: () => {
							if (decoded.column !== 'token_hash') return Promise.resolve([]);
							const row = dbState.rowsByTokenHash.get(String(decoded.value));
							return Promise.resolve(row ? [row] : []);
						}
					};
				}
			})
		}),
		delete: () => ({
			where: (filter: SQL) => {
				const decoded = decodeEqFilter(filter);
				dbState.deleteFilters.push(decoded);
				if (decoded.column === 'token_hash') {
					dbState.rowsByTokenHash.delete(String(decoded.value));
				}
				return Promise.resolve();
			}
		})
	})
}));

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

function seedSession(token: string, overrides: Partial<SessionRow> = {}): SessionRow {
	const row: SessionRow = {
		id: '01970000-0000-7000-8000-000000000000',
		realm: 'author',
		tokenHash: sha256(token),
		createdAt: new Date(Date.now() - 1000),
		expiresAt: new Date(Date.now() + 60_000),
		metadata: null,
		...overrides
	};
	dbState.rowsByTokenHash.set(row.tokenHash, row);
	return row;
}

beforeEach(() => {
	dbState.rowsByTokenHash.clear();
	dbState.inserted = [];
	dbState.whereFilters = [];
	dbState.deleteFilters = [];
});

describe('createAuthorSession', () => {
	it('returns a 256-bit base64url token and stores only its SHA-256 hash', async () => {
		const { token, expiresAt } = await createAuthorSession();

		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url
		expect(dbState.inserted).toHaveLength(1);
		const row = dbState.inserted[0];
		expect(row.tokenHash).toBe(sha256(token));
		expect(row.tokenHash).not.toContain(token);
		expect(row.realm).toBe('author');
		expect(row.expiresAt).toBe(expiresAt);
	});

	it('applies the fixed 7-day expiry', async () => {
		const before = Date.now();
		const { expiresAt } = await createAuthorSession();
		const after = Date.now();

		expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + AUTHOR_SESSION_TTL_MS);
		expect(expiresAt.getTime()).toBeLessThanOrEqual(after + AUTHOR_SESSION_TTL_MS);
	});

	it('assigns a UUIDv7 id and a fresh token per session', async () => {
		const first = await createAuthorSession();
		const second = await createAuthorSession();

		expect(first.token).not.toBe(second.token);
		for (const row of dbState.inserted) {
			expect(row.id).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
			);
		}
	});
});

describe('validateAuthorSession', () => {
	it('resolves a live author session by querying the sha256 of the token', async () => {
		const row = seedSession('some-token');

		const session = await validateAuthorSession('some-token');

		expect(session).toEqual({ id: row.id, createdAt: row.createdAt, expiresAt: row.expiresAt });
		expect(dbState.whereFilters).toEqual([{ column: 'token_hash', value: sha256('some-token') }]);
	});

	it('returns null for an unknown token', async () => {
		await expect(validateAuthorSession('unknown')).resolves.toBeNull();
	});

	it('never matches a session seeded under the raw token (hash-at-rest contract)', async () => {
		// A regression that filters on the raw token would find this row.
		seedSession('raw-token', { tokenHash: 'raw-token' });

		await expect(validateAuthorSession('raw-token')).resolves.toBeNull();
	});

	it('returns null for a reader-realm session (strict realm separation)', async () => {
		seedSession('reader-token', { realm: 'reader' });

		await expect(validateAuthorSession('reader-token')).resolves.toBeNull();
		expect(dbState.deleteFilters).toHaveLength(0);
	});

	it('deletes an expired session by id and rejects it', async () => {
		const row = seedSession('expired-token', { expiresAt: new Date(Date.now() - 1) });

		await expect(validateAuthorSession('expired-token')).resolves.toBeNull();
		expect(dbState.deleteFilters).toEqual([{ column: 'id', value: row.id }]);
	});
});

describe('destroySession', () => {
	it('deletes the session row by the sha256 of the token', async () => {
		seedSession('any-token');

		await destroySession('any-token');

		expect(dbState.deleteFilters).toEqual([{ column: 'token_hash', value: sha256('any-token') }]);
		expect(dbState.rowsByTokenHash.size).toBe(0);
	});
});
