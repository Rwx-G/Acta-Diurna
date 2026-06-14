/**
 * Personal access token (PAT) service (D10): the THIRD auth surface alongside
 * the author and reader cookie realms. A PAT is a high-entropy bearer credential
 * for scripts and agents to authenticate to `/api/v1`. It is NOT a cookie realm:
 * a PAT never opens a workspace/reader session, and a cookie never authorizes
 * the API (strict separation, NFR12 extended to the programmatic surface).
 *
 * A PAT is a high-entropy random token like a session/share token (NOT a
 * low-entropy human password), so SHA-256-at-rest + a constant-cost hash-keyed
 * lookup is the correct model - argon2 is reserved for the author password. The
 * raw token reaches the author ONCE at creation (it goes nowhere else); only its
 * hash is stored, so a database leak exposes no usable token.
 *
 * Format (backlog Epic 4 decision): a GitHub-style `acta_pat_` prefix followed by
 * 256 bits of base64url randomness. The prefix is NOT secret - it makes a leaked
 * token greppable and lets the bearer parser reject obviously-malformed values
 * cheaply before any DB lookup; the body after the prefix is the secret. A
 * non-secret `display_fragment` (the last 4 chars) is stored so the management
 * list distinguishes two tokens without re-revealing either. V1 is revoke-only,
 * no expiry.
 */
import { randomBytes } from 'node:crypto';
import { and, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { ownerFilter, ownerForInsert, type AuthorScope } from '../authors';
import { hashToken } from '../crypto/hash-token';
import { getDb } from '../db/client';
import {
	cursorPredicate,
	decodeCursor,
	pageSize,
	toPage,
	type Page,
	type PageRequest
} from '../db/cursor';
import { uuidv7 } from '../db/ids';
import { apiTokens, type ApiTokenRow } from '../db/schema';

/** Non-secret prefix (backlog Epic 4 decision): greppable, marks a value as an Acta PAT. */
export const PAT_PREFIX = 'acta_pat_';

/** 32 random bytes = 256 bits of entropy, well above the >= 128-bit floor (matches the session/share token strength). */
const PAT_BYTES = 32;

/** Length of the non-secret display fragment kept for the list UI (last N chars of the raw token). */
const DISPLAY_FRAGMENT_LENGTH = 4;

/** A token's lifecycle state, derived from `revokedAt`. V1 has no expiry, so a token is active until revoked. */
export type ApiTokenStatus = 'active' | 'revoked';

/** Management-view projection: never carries the raw token or the full hash. */
export interface ApiTokenSummary {
	id: string;
	name: string;
	displayFragment: string;
	createdAt: Date;
	lastUsedAt: Date | null;
	revokedAt: Date | null;
	status: ApiTokenStatus;
}

/** The one-time result of creating a token: the raw prefixed token (shown once) + the new row's summary. */
export interface CreatedApiToken {
	token: string;
	summary: ApiTokenSummary;
}

/**
 * The identity a resolved PAT authorizes on the API. The `tokenId` is carried for
 * audit/logging; `ownerId` (story 8.2) is the author the token belongs to - the
 * API surface resolves it into an `AuthorScope` so a PAT only ever reaches its
 * owner's resources. `ownerId` is null only for a legacy token whose owner was
 * not yet backfilled at resolution time (the scope resolver then falls back to
 * the implicit author); a live, post-inheritance token always carries one.
 */
export interface ApiIdentity {
	tokenId: string;
	ownerId: string | null;
}

function tokenStatus(row: Pick<ApiTokenRow, 'revokedAt'>): ApiTokenStatus {
	return row.revokedAt !== null ? 'revoked' : 'active';
}

function toSummary(row: ApiTokenRow): ApiTokenSummary {
	return {
		id: row.id,
		name: row.name,
		displayFragment: row.displayFragment,
		createdAt: row.createdAt,
		lastUsedAt: row.lastUsedAt ?? null,
		revokedAt: row.revokedAt ?? null,
		status: tokenStatus(row)
	};
}

/**
 * Creates an API token. Generates a 256-bit random token, prefixes it with
 * `acta_pat_`, and stores ONLY its SHA-256 hash plus the author-chosen name and a
 * non-secret display fragment (the last 4 chars). Returns the raw prefixed token
 * ONCE - it is never persisted on any column and never re-fetchable. The caller
 * shows it once and discards it.
 */
export async function createApiToken(name: string, scope: AuthorScope): Promise<CreatedApiToken> {
	const token = `${PAT_PREFIX}${randomBytes(PAT_BYTES).toString('base64url')}`;
	const displayFragment = token.slice(-DISPLAY_FRAGMENT_LENGTH);

	const row: ApiTokenRow = {
		id: uuidv7(),
		name,
		tokenHash: hashToken(token),
		displayFragment,
		ownerId: ownerForInsert(scope),
		createdAt: new Date(),
		lastUsedAt: null,
		revokedAt: null
	};
	await getDb().insert(apiTokens).values(row);

	return { token, summary: toSummary(row) };
}

/**
 * Lists a page of the author's tokens, newest first, for the management UI, with
 * keyset (cursor) pagination ({@link Page}). Returns id, name, display fragment,
 * timestamps, and the derived status - NEVER the raw token (it is gone after
 * creation) and never the hash. The keyset is `(created_at DESC, id DESC)`; an
 * absent cursor starts from the newest, `nextCursor` signals a further page
 * (full-audit C2). A revoke-only V1 keeps revoked rows for the audit trail, so the
 * table grows over a long-lived instance and paging keeps the settings load flat.
 */
export async function listApiTokens(
	scope: AuthorScope,
	page: PageRequest = {}
): Promise<Page<ApiTokenSummary>> {
	const limit = pageSize(page.limit);
	const predicates: SQL[] = [];
	const owner = ownerFilter(scope, apiTokens.ownerId);
	if (owner) predicates.push(owner);
	const keyset = cursorPredicate(decodeCursor(page.cursor), apiTokens.createdAt, apiTokens.id);
	if (keyset) predicates.push(keyset);

	let query = getDb().select().from(apiTokens).$dynamic();
	if (predicates.length > 0) {
		query = query.where(predicates.length === 1 ? predicates[0] : and(...predicates));
	}
	const rows = await query.orderBy(desc(apiTokens.createdAt), desc(apiTokens.id)).limit(limit + 1);
	return toPage(rows.map(toSummary), limit, (row) => ({ timestamp: row.createdAt, id: row.id }));
}

/**
 * Revokes a token (sets `revoked_at`). Idempotent: revoking an already-revoked
 * token is a no-op success (the `revoked_at IS NULL` guard preserves the original
 * instant), and an unknown id matches nothing and returns silently - the caller
 * has already resolved the token from its own author-realm list. The owner filter
 * (story 8.2) means a cross-author id matches zero rows too: an author can never
 * revoke another author's token (no existence oracle - the same silent no-op).
 */
export async function revokeApiToken(id: string, scope: AuthorScope): Promise<void> {
	await getDb()
		.update(apiTokens)
		.set({ revokedAt: new Date() })
		.where(
			and(eq(apiTokens.id, id), isNull(apiTokens.revokedAt), ownerFilter(scope, apiTokens.ownerId))
		);
}

/**
 * Resolves a raw bearer token to an author identity, or null. The prefix is
 * required and verified first (a value without it is rejected before any DB
 * lookup - cheap, and it keeps non-PAT garbage off the hash path). Hashes the
 * token and matches on the unique `token_hash` index; a revoked or unknown token
 * returns null. On a live match, `last_used_at` is stamped best-effort - a failed
 * write is logged-and-swallowed by the caller's fire-and-forget, never blocking
 * or failing the request.
 */
export async function authenticateApiToken(rawToken: string): Promise<ApiIdentity | null> {
	if (!rawToken.startsWith(PAT_PREFIX)) return null;

	const db = getDb();
	const rows = await db
		.select()
		.from(apiTokens)
		.where(eq(apiTokens.tokenHash, hashToken(rawToken)))
		.limit(1);
	const row = rows[0];

	if (!row || row.revokedAt !== null) return null;

	// Best-effort last-used stamp: a write failure must not fail the authenticated
	// request, so it is fire-and-forget. The identity is already resolved.
	void db
		.update(apiTokens)
		.set({ lastUsedAt: new Date() })
		.where(eq(apiTokens.id, row.id))
		.catch(() => {});

	return { tokenId: row.id, ownerId: row.ownerId ?? null };
}
