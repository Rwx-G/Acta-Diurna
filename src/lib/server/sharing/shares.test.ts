import { createHash } from 'node:crypto';
import { Column, Param, type SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '$lib/server/problem';
import type { ShareRow } from '../db/schema';
import {
	createShare,
	getShareByToken,
	isExpired,
	listShares,
	shareStatus,
	shareUrl
} from './shares';

// The store is keyed by token HASH (like the 1.4 sessions mock): a regression
// that queries by the raw token misses the map. `eq(column, value)` filters are
// decoded from drizzle's SQL chunks so the filtered COLUMN is asserted too.
const dbState = vi.hoisted(() => ({
	rows: [] as Record<string, unknown>[],
	inserted: [] as Record<string, unknown>[],
	whereFilters: [] as { column: string; value: unknown }[]
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
				dbState.rows.push(row);
				return Promise.resolve();
			}
		}),
		select: () => ({
			from: () => ({
				where: (filter: SQL) => {
					const decoded = decodeEqFilter(filter);
					dbState.whereFilters.push(decoded);
					const matched = dbState.rows.filter((row) => {
						if (decoded.column === 'token_hash') return row.tokenHash === decoded.value;
						if (decoded.column === 'report_id') return row.reportId === decoded.value;
						return false;
					});
					return {
						limit: () => Promise.resolve(matched.slice(0, 1)),
						orderBy: () => Promise.resolve(matched)
					};
				}
			})
		})
	})
}));

// getReport / assertShareable are the publish-lifecycle seam createShare reuses.
const reportsState = vi.hoisted(() => ({
	status: 'published' as 'draft' | 'published'
}));

vi.mock('$lib/server/documents/reports', () => ({
	getReport: (id: string) =>
		Promise.resolve({ id, title: 'A report', status: reportsState.status }),
	assertShareable: (report: { status: string }) => {
		if (report.status !== 'published') {
			throw new AppError({
				status: 409,
				title: 'Report is not published',
				type: '/problems/report-not-published',
				detail: 'Only a published report can be shared.'
			});
		}
	}
}));

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

const REPORT_ID = '0197b300-0000-7000-8000-000000000aaa';

function seedShare(overrides: Partial<ShareRow> = {}): ShareRow {
	const row: ShareRow = {
		id: '0197b300-0000-7000-8000-000000000001',
		reportId: REPORT_ID,
		tokenHash: sha256('seeded-token'),
		mode: 'restricted',
		expiresAt: null,
		createdAt: new Date('2026-06-12T10:00:00Z'),
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
	reportsState.status = 'published';
});

describe('createShare', () => {
	it('on a published report returns a raw token and persists only its hash', async () => {
		const { token, share } = await createShare(REPORT_ID);

		// >= 128 bits of entropy: 32 raw bytes base64url-encode to 43 chars.
		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(dbState.inserted).toHaveLength(1);
		const row = dbState.inserted[0];
		expect(row.tokenHash).toBe(sha256(token));
		expect(row.tokenHash).not.toBe(token);
		expect(row.tokenHash).not.toContain(token);
		// The raw token is on NO persisted column.
		expect(Object.values(row)).not.toContain(token);
		// And it never leaks into the returned summary.
		expect(JSON.stringify(share)).not.toContain(token);
	});

	it('defaults to restricted mode (the safe default for 3.4)', async () => {
		const { share } = await createShare(REPORT_ID);
		expect(share.mode).toBe('restricted');
		expect(dbState.inserted[0].mode).toBe('restricted');
	});

	it('accepts an explicit open mode', async () => {
		const { share } = await createShare(REPORT_ID, { mode: 'open' });
		expect(share.mode).toBe('open');
	});

	it('persists and round-trips an optional expiry (FR21)', async () => {
		const expiresAt = new Date(Date.now() + 86_400_000);
		const { share } = await createShare(REPORT_ID, { expiresAt });
		expect(share.expiresAt).toEqual(expiresAt);
		expect(dbState.inserted[0].expiresAt).toEqual(expiresAt);
		expect(share.status).toBe('active');
	});

	it('a null expiry means no time bound', async () => {
		const { share } = await createShare(REPORT_ID, { expiresAt: null });
		expect(share.expiresAt).toBeNull();
	});

	it('assigns a UUIDv7 id', async () => {
		await createShare(REPORT_ID);
		expect(dbState.inserted[0].id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
		);
	});

	it('refuses a past expiry with a 422', async () => {
		const past = new Date(Date.now() - 1000);
		await expect(createShare(REPORT_ID, { expiresAt: past })).rejects.toMatchObject({
			status: 422,
			type: '/problems/share-expiry-past'
		});
		expect(dbState.inserted).toHaveLength(0);
	});

	it('refuses a draft report via assertShareable and mints NO token', async () => {
		reportsState.status = 'draft';
		await expect(createShare(REPORT_ID)).rejects.toMatchObject({
			status: 409,
			type: '/problems/report-not-published'
		});
		expect(dbState.inserted).toHaveLength(0);
	});
});

describe('getShareByToken', () => {
	it('resolves a share by hashing the raw token (never a raw-token match)', async () => {
		const row = seedShare({ tokenHash: sha256('the-token') });

		const resolved = await getShareByToken('the-token');

		expect(resolved?.id).toBe(row.id);
		expect(resolved?.reportId).toBe(REPORT_ID);
		expect(dbState.whereFilters).toEqual([{ column: 'token_hash', value: sha256('the-token') }]);
	});

	it('round-trips a freshly created share', async () => {
		const { token, share } = await createShare(REPORT_ID);
		const resolved = await getShareByToken(token);
		expect(resolved?.id).toBe(share.id);
		expect(resolved?.status).toBe('active');
	});

	it('misses on a wrong token', async () => {
		seedShare({ tokenHash: sha256('right') });
		await expect(getShareByToken('wrong')).resolves.toBeNull();
	});

	it('never matches a row seeded under the raw token (hash-at-rest contract)', async () => {
		seedShare({ tokenHash: 'raw-token' });
		await expect(getShareByToken('raw-token')).resolves.toBeNull();
	});

	it('reports an active share', async () => {
		seedShare({ tokenHash: sha256('active'), expiresAt: new Date(Date.now() + 60_000) });
		const resolved = await getShareByToken('active');
		expect(resolved?.status).toBe('active');
	});

	it('reports an expired share', async () => {
		seedShare({ tokenHash: sha256('expired'), expiresAt: new Date(Date.now() - 1000) });
		const resolved = await getShareByToken('expired');
		expect(resolved?.status).toBe('expired');
	});

	it('reports a revoked share (revocation wins over an unexpired window)', async () => {
		seedShare({
			tokenHash: sha256('revoked'),
			revokedAt: new Date(Date.now() - 1000),
			expiresAt: new Date(Date.now() + 60_000)
		});
		const resolved = await getShareByToken('revoked');
		expect(resolved?.status).toBe('revoked');
	});

	it('reports revoked even past expiry (revocation wins over expiry)', async () => {
		seedShare({
			tokenHash: sha256('both'),
			revokedAt: new Date(Date.now() - 1000),
			expiresAt: new Date(Date.now() - 2000)
		});
		const resolved = await getShareByToken('both');
		expect(resolved?.status).toBe('revoked');
	});
});

describe('listShares', () => {
	it('projects each share by report id, never exposing a raw token', async () => {
		const { token } = await createShare(REPORT_ID);
		seedShare({ tokenHash: sha256('second'), reportId: REPORT_ID });

		const summaries = await listShares(REPORT_ID);

		expect(summaries.length).toBe(2);
		const serialized = JSON.stringify(summaries);
		expect(serialized).not.toContain(token);
		expect(serialized).not.toContain('tokenHash');
		for (const summary of summaries) {
			expect(summary).not.toHaveProperty('token');
			expect(summary).toHaveProperty('status');
			expect(summary).toHaveProperty('mode');
			expect(summary).toHaveProperty('expiresAt');
		}
		expect(dbState.whereFilters).toContainEqual({ column: 'report_id', value: REPORT_ID });
	});

	it('returns an empty list for a report with no shares', async () => {
		await expect(listShares(REPORT_ID)).resolves.toEqual([]);
	});
});

describe('shareStatus / isExpired', () => {
	const now = new Date('2026-06-12T12:00:00Z');

	it('is active with no expiry and no revocation', () => {
		expect(shareStatus({ expiresAt: null, revokedAt: null }, now)).toBe('active');
		expect(isExpired({ expiresAt: null }, now)).toBe(false);
	});

	it('is expired once expiresAt has elapsed', () => {
		const past = new Date('2026-06-12T11:00:00Z');
		expect(shareStatus({ expiresAt: past, revokedAt: null }, now)).toBe('expired');
		expect(isExpired({ expiresAt: past }, now)).toBe(true);
	});

	it('is active while expiresAt is in the future', () => {
		const future = new Date('2026-06-12T13:00:00Z');
		expect(shareStatus({ expiresAt: future, revokedAt: null }, now)).toBe('active');
		expect(isExpired({ expiresAt: future }, now)).toBe(false);
	});

	it('is revoked when revokedAt is set, regardless of expiry', () => {
		const future = new Date('2026-06-12T13:00:00Z');
		expect(shareStatus({ expiresAt: future, revokedAt: now }, now)).toBe('revoked');
	});
});

describe('shareUrl', () => {
	it('composes the public /r/[token] reader URL from the origin', () => {
		expect(shareUrl('https://acta.example.com', 'abc123')).toBe(
			'https://acta.example.com/r/abc123'
		);
	});
});
