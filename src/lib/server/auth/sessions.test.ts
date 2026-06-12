import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRow } from '../db/schema';
import {
	AUTHOR_SESSION_TTL_MS,
	createAuthorSession,
	destroySession,
	validateAuthorSession
} from './sessions';

const dbState = vi.hoisted(() => ({
	selectRows: [] as unknown[],
	inserted: [] as Record<string, unknown>[],
	deleteCalls: 0
}));

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
				where: () => ({
					limit: () => Promise.resolve(dbState.selectRows)
				})
			})
		}),
		delete: () => ({
			where: () => {
				dbState.deleteCalls += 1;
				return Promise.resolve();
			}
		})
	})
}));

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

function sessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
	return {
		id: '01970000-0000-7000-8000-000000000000',
		realm: 'author',
		tokenHash: 'irrelevant-for-mocked-lookup',
		createdAt: new Date(Date.now() - 1000),
		expiresAt: new Date(Date.now() + 60_000),
		metadata: null,
		...overrides
	};
}

beforeEach(() => {
	dbState.selectRows = [];
	dbState.inserted = [];
	dbState.deleteCalls = 0;
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
	it('resolves a live author session', async () => {
		const row = sessionRow();
		dbState.selectRows = [row];

		const session = await validateAuthorSession('some-token');

		expect(session).toEqual({ id: row.id, createdAt: row.createdAt, expiresAt: row.expiresAt });
	});

	it('returns null for an unknown token', async () => {
		await expect(validateAuthorSession('unknown')).resolves.toBeNull();
	});

	it('returns null for a reader-realm session (strict realm separation)', async () => {
		dbState.selectRows = [sessionRow({ realm: 'reader' })];

		await expect(validateAuthorSession('reader-token')).resolves.toBeNull();
		expect(dbState.deleteCalls).toBe(0);
	});

	it('deletes and rejects an expired session', async () => {
		dbState.selectRows = [sessionRow({ expiresAt: new Date(Date.now() - 1) })];

		await expect(validateAuthorSession('expired-token')).resolves.toBeNull();
		expect(dbState.deleteCalls).toBe(1);
	});
});

describe('destroySession', () => {
	it('deletes the session row for the token', async () => {
		await destroySession('any-token');

		expect(dbState.deleteCalls).toBe(1);
	});
});
