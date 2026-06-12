import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VerificationTokenRow } from '$lib/server/db/schema';
import {
	VERIFICATION_TOKEN_TTL_MS,
	consumeVerificationToken,
	issueVerificationToken
} from './verification';

// Mock store for verification_tokens. The consume path is an
// UPDATE ... SET consumed_at WHERE token_hash = ? AND share_id = ? AND
// consumed_at IS NULL ... RETURNING *, so the mock models the single-use claim
// exactly: a second consume of the same row finds consumed_at already set and
// returns zero rows.
const dbState = vi.hoisted(() => ({
	rows: [] as VerificationTokenRow[],
	inserted: [] as Record<string, unknown>[]
}));

interface DecodedFilter {
	tokenHash?: string;
	shareId?: string;
	requireUnconsumed: boolean;
}

function decodeWhere(filter: unknown): DecodedFilter {
	// Walk the drizzle SQL chunk tree collecting the eq() params and detecting the
	// isNull(consumed_at) guard, by stringifying the filter and reading the
	// embedded column refs + param values the mock recorded at build time. We use
	// the structured form the helpers below stash on the SQL object instead.
	return (filter as { __decoded: DecodedFilter }).__decoded;
}

vi.mock('drizzle-orm', async (importOriginal) => {
	const actual = await importOriginal<typeof import('drizzle-orm')>();
	// Wrap eq/and/isNull so the composed WHERE carries a structured descriptor the
	// mock can read without re-implementing drizzle's chunk decoding.
	const tag = (descriptor: Partial<DecodedFilter>) =>
		Object.assign({}, { __descriptor: descriptor });
	return {
		...actual,
		eq: (col: { name: string }, value: unknown) =>
			tag(col.name === 'token_hash' ? { tokenHash: String(value) } : { shareId: String(value) }),
		isNull: () => tag({ requireUnconsumed: true }),
		and: (...parts: { __descriptor: Partial<DecodedFilter> }[]) => {
			const merged: DecodedFilter = { requireUnconsumed: false };
			for (const p of parts) Object.assign(merged, p.__descriptor);
			return { __decoded: merged };
		}
	};
});

vi.mock('$lib/server/db/client', () => ({
	getDb: () => ({
		insert: () => ({
			values: (row: Record<string, unknown>) => {
				dbState.inserted.push(row);
				// Postgres defaults consumed_at to NULL; the row passed in omits it.
				dbState.rows.push({ consumedAt: null, ...row } as VerificationTokenRow);
				return Promise.resolve();
			}
		}),
		update: () => ({
			set: (patch: Partial<VerificationTokenRow>) => ({
				where: (filter: unknown) => {
					const decoded = decodeWhere(filter);
					return {
						returning: () => {
							const match = dbState.rows.find(
								(r) =>
									r.tokenHash === decoded.tokenHash &&
									r.shareId === decoded.shareId &&
									(!decoded.requireUnconsumed || r.consumedAt === null)
							);
							if (!match) return Promise.resolve([]);
							Object.assign(match, patch);
							return Promise.resolve([{ ...match }]);
						}
					};
				}
			})
		})
	})
}));

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

beforeEach(() => {
	dbState.rows = [];
	dbState.inserted = [];
});

describe('issueVerificationToken', () => {
	it('returns a raw token, stores only its hash, binds the share + email, 15-min TTL', async () => {
		const before = Date.now();
		const { token, expiresAt } = await issueVerificationToken('share-1', 'reader@example.com');
		const after = Date.now();

		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		const row = dbState.inserted[0];
		expect(row.tokenHash).toBe(sha256(token));
		expect(row.tokenHash).not.toContain(token);
		expect(row.shareId).toBe('share-1');
		expect(row.email).toBe('reader@example.com');
		expect(row.consumedAt).toBeUndefined();
		expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + VERIFICATION_TOKEN_TTL_MS);
		expect(expiresAt.getTime()).toBeLessThanOrEqual(after + VERIFICATION_TOKEN_TTL_MS);
	});
});

describe('consumeVerificationToken (single-use, TTL, binding)', () => {
	it('consumes a valid token once and returns its binding', async () => {
		const { token } = await issueVerificationToken('share-1', 'reader@example.com');

		const result = await consumeVerificationToken(token, 'share-1');

		expect(result).toEqual({ shareId: 'share-1', email: 'reader@example.com' });
	});

	it('rejects a SECOND use of the same token (single-use)', async () => {
		const { token } = await issueVerificationToken('share-1', 'reader@example.com');

		await consumeVerificationToken(token, 'share-1');
		const second = await consumeVerificationToken(token, 'share-1');

		expect(second).toBeNull();
	});

	it('rejects an expired token (15-min TTL)', async () => {
		const { token } = await issueVerificationToken('share-1', 'reader@example.com');
		// Force the stored row past its expiry.
		dbState.rows[0].expiresAt = new Date(Date.now() - 1);

		await expect(consumeVerificationToken(token, 'share-1')).resolves.toBeNull();
	});

	it('does not verify a token bound to share A when presented for share B', async () => {
		const { token } = await issueVerificationToken('share-A', 'reader@example.com');

		await expect(consumeVerificationToken(token, 'share-B')).resolves.toBeNull();
		// And the share-A row is still unconsumed (the wrong-share attempt did not burn it).
		expect(dbState.rows[0].consumedAt ?? null).toBeNull();
	});

	it('rejects an unknown token', async () => {
		await expect(consumeVerificationToken('never-issued', 'share-1')).resolves.toBeNull();
	});
});
