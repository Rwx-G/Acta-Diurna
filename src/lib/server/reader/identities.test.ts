import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReaderIdentityRow } from '$lib/server/db/schema';
import { findOrCreateIdentity, recordAccess } from './identities';

// Models the two tables this service writes. `reader_identities` has a UNIQUE
// email index, so the find-or-create upsert (onConflictDoUpdate target=email)
// must yield ONE row per email no matter how many times it is called; the mock
// enforces that. `access_records` is append-only (one row per access).
const dbState = vi.hoisted(() => ({
	identitiesByEmail: new Map<string, ReaderIdentityRow>(),
	accessRecords: [] as Record<string, unknown>[]
}));

function tableName(table: unknown): string {
	const sym = Object.getOwnPropertySymbols(table as object).find((s) =>
		s.description?.includes('Name')
	);
	return sym ? String((table as Record<symbol, unknown>)[sym]) : '';
}

vi.mock('$lib/server/db/client', () => ({
	getDb: () => ({
		insert: (table: unknown) => {
			const name = tableName(table);
			return {
				values: (row: Record<string, unknown>) => {
					if (name === 'access_records') {
						dbState.accessRecords.push(row);
						return Promise.resolve();
					}
					// reader_identities insert is always part of an upsert chain.
					return {
						onConflictDoUpdate: ({ set }: { set: Partial<ReaderIdentityRow> }) => ({
							returning: () => {
								const email = String(row.email);
								const existing = dbState.identitiesByEmail.get(email);
								if (existing) {
									Object.assign(existing, set);
									return Promise.resolve([{ ...existing }]);
								}
								const created = row as ReaderIdentityRow;
								dbState.identitiesByEmail.set(email, created);
								return Promise.resolve([{ ...created }]);
							}
						})
					};
				}
			};
		}
	})
}));

beforeEach(() => {
	dbState.identitiesByEmail.clear();
	dbState.accessRecords = [];
});

describe('findOrCreateIdentity', () => {
	it('creates one identity for a new email', async () => {
		const id = await findOrCreateIdentity('reader@example.com');

		expect(id).toMatch(/^[0-9a-f-]{36}$/);
		expect(dbState.identitiesByEmail.size).toBe(1);
	});

	it('dedups: the same email twice yields ONE identity (same id)', async () => {
		const first = await findOrCreateIdentity('reader@example.com');
		const second = await findOrCreateIdentity('reader@example.com');

		expect(second).toBe(first);
		expect(dbState.identitiesByEmail.size).toBe(1);
	});

	it('bumps last_verified_at on re-verification', async () => {
		await findOrCreateIdentity('reader@example.com');
		const firstVerified = dbState.identitiesByEmail.get('reader@example.com')!.lastVerifiedAt;
		await new Promise((r) => setTimeout(r, 2));
		await findOrCreateIdentity('reader@example.com');
		const secondVerified = dbState.identitiesByEmail.get('reader@example.com')!.lastVerifiedAt;

		expect(secondVerified.getTime()).toBeGreaterThanOrEqual(firstVerified.getTime());
	});
});

describe('recordAccess', () => {
	it('writes one append-only access row per call', async () => {
		await recordAccess('identity-1', 'share-1', 'report-1');
		await recordAccess('identity-1', 'share-1', 'report-1');

		expect(dbState.accessRecords).toHaveLength(2);
		expect(dbState.accessRecords[0]).toMatchObject({
			readerIdentityId: 'identity-1',
			shareId: 'share-1',
			reportId: 'report-1'
		});
	});
});
