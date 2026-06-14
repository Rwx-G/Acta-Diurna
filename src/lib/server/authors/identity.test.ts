import { Column, Param } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	__resetDisplayEmailCache,
	__resetImplicitAuthorCache,
	SINGLE_AUTHOR_EMAIL,
	authorDisplayEmail,
	ensureAuthor,
	implicitAuthorEmail,
	implicitAuthorId
} from './identity';

// The env is mocked so implicitAuthorEmail can be exercised with and without
// INITIAL_OWNER_EMAIL without booting the full env schema.
const envState = vi.hoisted(() => ({ initialOwnerEmail: undefined as string | undefined }));
vi.mock('$lib/server/env', () => ({
	serverEnv: () => ({ INITIAL_OWNER_EMAIL: envState.initialOwnerEmail })
}));

const dbState = vi.hoisted(() => ({
	rowsByEmail: new Map<string, { id: string }>(),
	rowsById: new Map<string, { email: string }>(),
	inserted: [] as Record<string, unknown>[],
	idLookups: 0
}));

function decodeEqColumnValue(filter: unknown): { column: string; value: unknown } {
	const chunks = (filter as { queryChunks: unknown[] }).queryChunks;
	const column = chunks.find((chunk): chunk is Column => chunk instanceof Column);
	const param = chunks.find((chunk): chunk is Param => chunk instanceof Param);
	if (!column || !param) throw new Error('expected eq(column, value)');
	return { column: column.name, value: param.value };
}

vi.mock('$lib/server/db/client', () => ({
	getDb: () => ({
		select: () => ({
			from: () => ({
				where: (filter: unknown) => ({
					limit: () => {
						const { column, value } = decodeEqColumnValue(filter);
						if (column === 'id') {
							dbState.idLookups += 1;
							const row = dbState.rowsById.get(String(value));
							return Promise.resolve(row ? [row] : []);
						}
						const row = dbState.rowsByEmail.get(String(value));
						return Promise.resolve(row ? [row] : []);
					}
				})
			})
		}),
		insert: () => ({
			values: (row: Record<string, unknown>) => {
				dbState.inserted.push(row);
				dbState.rowsByEmail.set(String(row.email), { id: String(row.id) });
				dbState.rowsById.set(String(row.id), { email: String(row.email) });
				return Promise.resolve();
			}
		})
	})
}));

beforeEach(() => {
	dbState.rowsByEmail.clear();
	dbState.rowsById.clear();
	dbState.inserted = [];
	dbState.idLookups = 0;
	envState.initialOwnerEmail = undefined;
	__resetImplicitAuthorCache();
	__resetDisplayEmailCache();
});

describe('implicitAuthorEmail', () => {
	it('is the reserved sentinel when INITIAL_OWNER_EMAIL is unset (pure single mode)', () => {
		envState.initialOwnerEmail = undefined;
		expect(implicitAuthorEmail()).toBe(SINGLE_AUTHOR_EMAIL);
	});

	it('is INITIAL_OWNER_EMAIL, normalized, when the operator declared it', () => {
		envState.initialOwnerEmail = 'Owner@Example.com';
		expect(implicitAuthorEmail()).toBe('owner@example.com');
	});
});

describe('ensureAuthor', () => {
	it('mints a new author row for an unseen email and returns its id', async () => {
		const id = await ensureAuthor('owner@example.com');
		expect(id).toMatch(/^[0-9a-f-]{36}$/);
		expect(dbState.inserted).toHaveLength(1);
		expect(dbState.inserted[0].email).toBe('owner@example.com');
	});

	it('is idempotent: a second call for the same email returns the existing id, no second insert', async () => {
		const first = await ensureAuthor('owner@example.com');
		const second = await ensureAuthor('owner@example.com');
		expect(second).toBe(first);
		expect(dbState.inserted).toHaveLength(1);
	});
});

describe('authorDisplayEmail', () => {
	it('returns the email for a real (multi-mode) author id', async () => {
		const id = await ensureAuthor('author@example.com');
		await expect(authorDisplayEmail(id)).resolves.toBe('author@example.com');
	});

	it('returns null for the implicit author (the sentinel is never a shown identity)', async () => {
		const id = await ensureAuthor(SINGLE_AUTHOR_EMAIL);
		await expect(authorDisplayEmail(id)).resolves.toBeNull();
	});

	it('returns null for an unknown id', async () => {
		await expect(authorDisplayEmail('01970000-0000-7000-8000-0000000000ff')).resolves.toBeNull();
	});

	it('caches the email per author id: a repeated lookup hits the cache, not the DB (E8)', async () => {
		const id = await ensureAuthor('author@example.com');

		const first = await authorDisplayEmail(id);
		const second = await authorDisplayEmail(id);
		const third = await authorDisplayEmail(id);

		expect(first).toBe('author@example.com');
		expect(second).toBe('author@example.com');
		expect(third).toBe('author@example.com');
		// Only the first call queried the DB; the rest were Map hits.
		expect(dbState.idLookups).toBe(1);
	});

	it('caches the resolved null (implicit author / unknown id) too', async () => {
		const unknownId = '01970000-0000-7000-8000-0000000000ff';

		await expect(authorDisplayEmail(unknownId)).resolves.toBeNull();
		await expect(authorDisplayEmail(unknownId)).resolves.toBeNull();

		expect(dbState.idLookups).toBe(1);
	});
});

describe('implicitAuthorId', () => {
	it('seeds the implicit author and caches the id across calls', async () => {
		const first = await implicitAuthorId();
		const second = await implicitAuthorId();
		expect(second).toBe(first);
		// One insert only: the cache means the second call never re-queries or re-inserts.
		expect(dbState.inserted).toHaveLength(1);
		expect(dbState.inserted[0].email).toBe(SINGLE_AUTHOR_EMAIL);
	});
});
