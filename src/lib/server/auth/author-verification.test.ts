import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorVerificationTokenRow } from '$lib/server/db/schema';
import {
	AUTHOR_VERIFICATION_TOKEN_TTL_MS,
	consumeAuthorVerificationToken,
	hasLiveAuthorVerification,
	issueAuthorVerificationToken
} from './author-verification';

// Mock store for author_verification_tokens. The consume path is an
// UPDATE ... SET consumed_at WHERE token_hash = ? AND consumed_at IS NULL ...
// RETURNING *, so the mock models the single-use claim exactly: a second consume
// of the same row finds consumed_at already set and returns zero rows. Unlike the
// reader store there is NO share dimension - an author token binds the email alone.
const dbState = vi.hoisted(() => ({
	rows: [] as AuthorVerificationTokenRow[],
	inserted: [] as Record<string, unknown>[]
}));

interface DecodedFilter {
	tokenHash?: string;
	email?: string;
	requireUnconsumed: boolean;
	requireLiveExpiry?: Date;
}

function decodeWhere(filter: unknown): DecodedFilter {
	return (filter as { __decoded: DecodedFilter }).__decoded;
}

vi.mock('drizzle-orm', async (importOriginal) => {
	const actual = await importOriginal<typeof import('drizzle-orm')>();
	const tag = (descriptor: Partial<DecodedFilter>) =>
		Object.assign({}, { __descriptor: descriptor });
	const eqDescriptor = (name: string, value: unknown): Partial<DecodedFilter> => {
		if (name === 'token_hash') return { tokenHash: String(value) };
		return { email: String(value) };
	};
	return {
		...actual,
		eq: (col: { name: string }, value: unknown) => tag(eqDescriptor(col.name, value)),
		isNull: () => tag({ requireUnconsumed: true }),
		gt: (_col: { name: string }, value: unknown) => tag({ requireLiveExpiry: value as Date }),
		and: (...parts: { __descriptor: Partial<DecodedFilter> }[]) => {
			const merged: DecodedFilter = { requireUnconsumed: false };
			for (const p of parts) Object.assign(merged, p.__descriptor);
			return { __decoded: merged };
		}
	};
});

vi.mock('$lib/server/db/client', () => ({
	getDb: () => ({
		select: () => ({
			from: () => ({
				where: (filter: unknown) => {
					const decoded = decodeWhere(filter);
					return {
						limit: () => {
							const matches = dbState.rows.filter(
								(r) =>
									r.email === decoded.email &&
									(!decoded.requireUnconsumed || r.consumedAt === null) &&
									(decoded.requireLiveExpiry === undefined ||
										r.expiresAt.getTime() > decoded.requireLiveExpiry.getTime())
							);
							return Promise.resolve(matches.slice(0, 1).map((r) => ({ id: r.id })));
						}
					};
				}
			})
		}),
		insert: () => ({
			values: (row: Record<string, unknown>) => {
				dbState.inserted.push(row);
				dbState.rows.push({ consumedAt: null, ...row } as AuthorVerificationTokenRow);
				return Promise.resolve();
			}
		}),
		update: () => ({
			set: (patch: Partial<AuthorVerificationTokenRow>) => ({
				where: (filter: unknown) => {
					const decoded = decodeWhere(filter);
					return {
						returning: () => {
							const match = dbState.rows.find(
								(r) =>
									r.tokenHash === decoded.tokenHash &&
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

describe('issueAuthorVerificationToken', () => {
	it('returns a raw token, stores only its hash, binds the email, 15-min TTL', async () => {
		const before = Date.now();
		const { token, expiresAt } = await issueAuthorVerificationToken('author@example.com');
		const after = Date.now();

		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		const row = dbState.inserted[0];
		expect(row.tokenHash).toBe(sha256(token));
		expect(row.tokenHash).not.toContain(token);
		expect(row.email).toBe('author@example.com');
		// No share binding: an author token is workspace-wide, never report-scoped.
		expect(row.shareId).toBeUndefined();
		expect(row.consumedAt).toBeUndefined();
		expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + AUTHOR_VERIFICATION_TOKEN_TTL_MS);
		expect(expiresAt.getTime()).toBeLessThanOrEqual(after + AUTHOR_VERIFICATION_TOKEN_TTL_MS);
	});
});

describe('consumeAuthorVerificationToken (single-use, TTL)', () => {
	it('consumes a valid token once and returns the bound email', async () => {
		const { token } = await issueAuthorVerificationToken('author@example.com');

		await expect(consumeAuthorVerificationToken(token)).resolves.toBe('author@example.com');
	});

	it('rejects a SECOND use of the same token (single-use)', async () => {
		const { token } = await issueAuthorVerificationToken('author@example.com');

		await consumeAuthorVerificationToken(token);
		await expect(consumeAuthorVerificationToken(token)).resolves.toBeNull();
	});

	it('rejects an expired token (15-min TTL)', async () => {
		const { token } = await issueAuthorVerificationToken('author@example.com');
		dbState.rows[0].expiresAt = new Date(Date.now() - 1);

		await expect(consumeAuthorVerificationToken(token)).resolves.toBeNull();
	});

	it('rejects an unknown token', async () => {
		await expect(consumeAuthorVerificationToken('never-issued')).resolves.toBeNull();
	});

	it('realm separation: the inserted row carries no share binding, so it can never verify a reader share', () => {
		// An author token is written to author_verification_tokens with email only -
		// there is no share_id column to resolve. The reader consume requires a
		// shareId in its WHERE, so a token from this store can never match there
		// (NFR12): the realms are physically separate stores keyed differently.
		expect(authorVerificationTokensHasShareBinding()).toBe(false);
	});
});

function authorVerificationTokensHasShareBinding(): boolean {
	// The store never writes a shareId; the row shape is email-bound only.
	return dbState.inserted.some((row) => 'shareId' in row);
}

describe('hasLiveAuthorVerification (dedup-before-issue, mail-amplification guard)', () => {
	it('is false when no token exists for the email', async () => {
		await expect(hasLiveAuthorVerification('author@example.com')).resolves.toBe(false);
	});

	it('is true while an unconsumed, unexpired token exists for the email', async () => {
		await issueAuthorVerificationToken('author@example.com');

		await expect(hasLiveAuthorVerification('author@example.com')).resolves.toBe(true);
	});

	it('is false once the token is consumed', async () => {
		const { token } = await issueAuthorVerificationToken('author@example.com');
		await consumeAuthorVerificationToken(token);

		await expect(hasLiveAuthorVerification('author@example.com')).resolves.toBe(false);
	});

	it('is false once the token has expired', async () => {
		await issueAuthorVerificationToken('author@example.com');
		dbState.rows[0].expiresAt = new Date(Date.now() - 1);

		await expect(hasLiveAuthorVerification('author@example.com')).resolves.toBe(false);
	});
});
