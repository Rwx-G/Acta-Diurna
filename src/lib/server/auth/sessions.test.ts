import { createHash } from 'node:crypto';
import { Column, Param, type SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReaderSessionRow, SessionRow } from '../db/schema';
import {
	AUTHOR_SESSION_TTL_MS,
	createAuthorSession,
	createReaderSession,
	destroyReaderSession,
	destroySession,
	validateAuthorSession,
	validateReaderSession
} from './sessions';

const env = vi.hoisted(() => ({ READER_SESSION_TTL: undefined as number | undefined }));
vi.mock('$lib/server/env', () => ({ serverEnv: () => env }));

// The mock is keyed by token HASH and is TABLE-AWARE: the author `sessions`
// table and the reader `reader_sessions` table keep separate row maps, so a
// reader-session lookup can never accidentally resolve an author row (and the
// realm-separation assertions are real). The drizzle table object passed to
// insert/from carries its SQL name on a well-known symbol; we read it to route.
const dbState = vi.hoisted(() => ({
	sessions: new Map<string, Record<string, unknown>>(),
	readerSessions: new Map<string, Record<string, unknown>>(),
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

function tableName(table: unknown): string {
	// drizzle stores the SQL table name on a symbol; the string fallback keeps the
	// mock resilient if the symbol name shifts across drizzle versions.
	const sym = Object.getOwnPropertySymbols(table as object).find((s) =>
		s.description?.includes('Name')
	);
	return sym ? String((table as Record<symbol, unknown>)[sym]) : '';
}

function mapFor(table: unknown): Map<string, Record<string, unknown>> {
	return tableName(table) === 'reader_sessions' ? dbState.readerSessions : dbState.sessions;
}

vi.mock('$lib/server/db/client', () => ({
	getDb: () => ({
		insert: (table: unknown) => ({
			values: (row: Record<string, unknown>) => {
				dbState.inserted.push(row);
				mapFor(table).set(String(row.tokenHash), row);
				return Promise.resolve();
			}
		}),
		select: () => ({
			from: (table: unknown) => ({
				where: (filter: SQL) => {
					const decoded = decodeEqFilter(filter);
					dbState.whereFilters.push(decoded);
					return {
						limit: () => {
							if (decoded.column !== 'token_hash') return Promise.resolve([]);
							const row = mapFor(table).get(String(decoded.value));
							return Promise.resolve(row ? [row] : []);
						}
					};
				}
			})
		}),
		delete: (table: unknown) => ({
			where: (filter: SQL) => {
				const decoded = decodeEqFilter(filter);
				dbState.deleteFilters.push(decoded);
				const map = mapFor(table);
				if (decoded.column === 'token_hash') {
					map.delete(String(decoded.value));
				} else if (decoded.column === 'id') {
					for (const [hash, row] of map) {
						if (row.id === decoded.value) map.delete(hash);
					}
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
		authorId: null,
		createdAt: new Date(Date.now() - 1000),
		expiresAt: new Date(Date.now() + 60_000),
		metadata: null,
		...overrides
	};
	dbState.sessions.set(row.tokenHash, row);
	return row;
}

function seedReaderSession(
	token: string,
	overrides: Partial<ReaderSessionRow> = {}
): ReaderSessionRow {
	const row: ReaderSessionRow = {
		id: '01970000-0000-7000-8000-0000000000aa',
		tokenHash: sha256(token),
		shareId: 'share-1',
		reportId: 'report-1',
		readerIdentityId: 'identity-1',
		createdAt: new Date(Date.now() - 1000),
		expiresAt: new Date(Date.now() + 60_000),
		...overrides
	};
	dbState.readerSessions.set(row.tokenHash, row);
	return row;
}

beforeEach(() => {
	dbState.sessions.clear();
	dbState.readerSessions.clear();
	dbState.inserted = [];
	dbState.whereFilters = [];
	dbState.deleteFilters = [];
	env.READER_SESSION_TTL = undefined;
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

	it('stores a null author_id by default (single-mode password session)', async () => {
		await createAuthorSession();
		expect(dbState.inserted[0].authorId).toBeNull();
	});

	it('binds the author id when one is passed (multi-mode magic-link session)', async () => {
		await createAuthorSession('author-id-1');
		expect(dbState.inserted[0].authorId).toBe('author-id-1');
	});
});

describe('validateAuthorSession', () => {
	it('resolves a live author session by querying the sha256 of the token', async () => {
		const row = seedSession('some-token');

		const session = await validateAuthorSession('some-token');

		expect(session).toEqual({
			id: row.id,
			authorId: row.authorId,
			createdAt: row.createdAt,
			expiresAt: row.expiresAt
		});
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
		expect(dbState.sessions.size).toBe(0);
	});
});

describe('createReaderSession', () => {
	it('stores only the token hash, binds share/report/identity, has NO expiry when READER_SESSION_TTL is unset', async () => {
		const { token, expiresAt } = await createReaderSession({
			shareId: 'share-9',
			reportId: 'report-9',
			readerIdentityId: 'identity-9'
		});

		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		const inserted = dbState.inserted[0];
		expect(inserted.tokenHash).toBe(sha256(token));
		expect(inserted.tokenHash).not.toContain(token);
		expect(inserted.shareId).toBe('share-9');
		expect(inserted.reportId).toBe('report-9');
		expect(inserted.readerIdentityId).toBe('identity-9');
		// Default: no time bound. The share governs access, not a session TTL.
		expect(expiresAt).toBeNull();
		expect(inserted.expiresAt).toBeNull();
	});

	it('honors READER_SESSION_TTL (days) when set: the session ages out after N days', async () => {
		env.READER_SESSION_TTL = 1;
		const before = Date.now();
		const { expiresAt } = await createReaderSession({
			shareId: 's',
			reportId: 'r',
			readerIdentityId: 'i'
		});
		const after = Date.now();
		const oneDay = 24 * 60 * 60 * 1000;

		expect(expiresAt).not.toBeNull();
		expect(expiresAt!.getTime()).toBeGreaterThanOrEqual(before + oneDay);
		expect(expiresAt!.getTime()).toBeLessThanOrEqual(after + oneDay);
	});
});

describe('validateReaderSession (per-share scope)', () => {
	it('resolves a live reader session for its own share', async () => {
		const row = seedReaderSession('reader-token');

		const session = await validateReaderSession('reader-token', 'share-1');

		expect(session).toEqual({
			id: row.id,
			shareId: row.shareId,
			reportId: row.reportId,
			readerIdentityId: row.readerIdentityId,
			createdAt: row.createdAt,
			expiresAt: row.expiresAt
		});
	});

	it('returns null for a session bound to a DIFFERENT share (per-share binding)', async () => {
		seedReaderSession('reader-token', { shareId: 'share-1' });

		// A valid token, but validated against another share: no authorization.
		await expect(validateReaderSession('reader-token', 'share-2')).resolves.toBeNull();
	});

	it('resolves a session with no expiry (expiresAt null) and never sweeps it', async () => {
		const row = seedReaderSession('eternal-reader', { expiresAt: null });

		const session = await validateReaderSession('eternal-reader', 'share-1');

		expect(session).toEqual({
			id: row.id,
			shareId: row.shareId,
			reportId: row.reportId,
			readerIdentityId: row.readerIdentityId,
			createdAt: row.createdAt,
			expiresAt: null
		});
		// A null-expiry session is the default and must not be deleted on sight.
		expect(dbState.readerSessions.size).toBe(1);
		expect(dbState.deleteFilters).toHaveLength(0);
	});

	it('returns null and deletes a reader session past its explicit (operator-set) expiry', async () => {
		seedReaderSession('expired-reader', { expiresAt: new Date(Date.now() - 1) });

		await expect(validateReaderSession('expired-reader', 'share-1')).resolves.toBeNull();
		expect(dbState.readerSessions.size).toBe(0);
	});

	it('never resolves an author session as a reader session (realm separation)', async () => {
		// Seed an AUTHOR row under a token; validating it as a reader misses the
		// reader_sessions map entirely.
		seedSession('author-token');

		await expect(validateReaderSession('author-token', 'share-1')).resolves.toBeNull();
	});

	it('returns null for an unknown reader token', async () => {
		await expect(validateReaderSession('nope', 'share-1')).resolves.toBeNull();
	});
});

describe('destroyReaderSession', () => {
	it('deletes the reader session by token hash', async () => {
		seedReaderSession('bye-token');

		await destroyReaderSession('bye-token');

		expect(dbState.readerSessions.size).toBe(0);
		expect(dbState.deleteFilters).toContainEqual({
			column: 'token_hash',
			value: sha256('bye-token')
		});
	});
});
