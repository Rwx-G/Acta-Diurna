import { Column, Param } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	__resetImplicitAuthorCache,
	SINGLE_AUTHOR_EMAIL,
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
	inserted: [] as Record<string, unknown>[]
}));

function decodeEqValue(filter: unknown): unknown {
	const chunks = (filter as { queryChunks: unknown[] }).queryChunks;
	const column = chunks.find((chunk): chunk is Column => chunk instanceof Column);
	const param = chunks.find((chunk): chunk is Param => chunk instanceof Param);
	if (!column || column.name !== 'email' || !param) throw new Error('expected eq(email, value)');
	return param.value;
}

vi.mock('$lib/server/db/client', () => ({
	getDb: () => ({
		select: () => ({
			from: () => ({
				where: (filter: unknown) => ({
					limit: () => {
						const email = decodeEqValue(filter);
						const row = dbState.rowsByEmail.get(String(email));
						return Promise.resolve(row ? [row] : []);
					}
				})
			})
		}),
		insert: () => ({
			values: (row: Record<string, unknown>) => {
				dbState.inserted.push(row);
				dbState.rowsByEmail.set(String(row.email), { id: String(row.id) });
				return Promise.resolve();
			}
		})
	})
}));

beforeEach(() => {
	dbState.rowsByEmail.clear();
	dbState.inserted = [];
	envState.initialOwnerEmail = undefined;
	__resetImplicitAuthorCache();
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
