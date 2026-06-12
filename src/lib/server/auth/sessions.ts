import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { uuidv7 } from '../db/ids';
import { hashToken } from '../crypto/hash-token';
import { readerSessions, sessions } from '../db/schema';
import { serverEnv } from '../env';

/**
 * Realm-parameterized session core (NFR12 / architecture D4). The two realms are
 * strictly separated - an author cookie never authorizes a reader route and vice
 * versa - and they differ in three ways the realm config below captures:
 *
 *   - TTL: author is a fixed 7 days (single known user, a hard lifetime bound is
 *     simplest); reader sessions have NO expiry by default (FR23 "verify once,
 *     read freely") - access is governed entirely by the share's own expiry +
 *     revocation, which the reader gate re-checks on every load. READER_SESSION_TTL
 *     is an OPTIONAL operator override that, when set to N days, makes reader
 *     sessions age out; unset (the default) means a reader session never expires.
 *   - Binding: an author session authorizes the whole workspace; a reader session
 *     is bound to ONE share/report (per-share scope, backlog decision) - a session
 *     verified for report A grants nothing for report B.
 *   - Lifecycle: an author session is deleted-on-sight when expired; a reader
 *     access is also recorded in `access_records` at creation (the audit trail
 *     FR22 requires), with the session row still expired-deleted on sight.
 *
 * The 256-bit random token reaches the caller once (the cookie); only its
 * SHA-256 hash is stored (shared {@link hashToken} helper). The two realms live
 * in two physical tables (`sessions`, `reader_sessions`) so each keeps its own
 * NOT NULL guarantees and FK shape; the `realm` here is the code-level selector,
 * not a discriminator column on one shared table.
 */

/** Author sessions: fixed 7-day expiry, no sliding renewal. */
export const AUTHOR_SESSION_TTL_MS: number = 7 * 24 * 60 * 60 * 1000;

/**
 * Reader-session TTL in milliseconds, or null when there is no time bound. null
 * is the default (READER_SESSION_TTL unset): reader sessions never age out on
 * their own and the share governs access. A number is the optional operator
 * override (READER_SESSION_TTL = N days).
 */
function readerSessionTtlMs(): number | null {
	const days = serverEnv().READER_SESSION_TTL;
	return days === undefined ? null : days * 24 * 60 * 60 * 1000;
}

const TOKEN_BYTES = 32;

export interface AuthorSession {
	id: string;
	createdAt: Date;
	expiresAt: Date;
}

/** A live reader session, carrying the share/report it was verified for (per-share scope). */
export interface ReaderSession {
	id: string;
	shareId: string;
	reportId: string;
	readerIdentityId: string;
	createdAt: Date;
	/** null = no time bound (the default); a Date = the optional operator-set expiry. */
	expiresAt: Date | null;
}

/** Author-realm creation result: a reader session always has a concrete expiry. */
export interface CreatedSession {
	token: string;
	expiresAt: Date;
}

/** Reader-realm creation result: expiry is null when no TTL override is configured. */
export interface CreatedReaderSession {
	token: string;
	/** null = no expiry (the default); a Date = the optional operator-set expiry. */
	expiresAt: Date | null;
}

/* -------------------------------------------------------------------------- */
/* Author realm                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Creates an author-realm session: a 256-bit random token goes to the caller
 * (cookie), only its SHA-256 hash is stored.
 */
export async function createAuthorSession(): Promise<CreatedSession> {
	const token = randomBytes(TOKEN_BYTES).toString('base64url');
	const expiresAt = new Date(Date.now() + AUTHOR_SESSION_TTL_MS);

	await getDb()
		.insert(sessions)
		.values({
			id: uuidv7(),
			realm: 'author',
			tokenHash: hashToken(token),
			expiresAt
		});

	return { token, expiresAt };
}

/**
 * Resolves a raw token to a live author session, or null. Expired rows are
 * deleted on sight so the table does not accumulate dead sessions.
 */
export async function validateAuthorSession(token: string): Promise<AuthorSession | null> {
	const db = getDb();
	const rows = await db
		.select()
		.from(sessions)
		.where(eq(sessions.tokenHash, hashToken(token)))
		.limit(1);
	const row = rows[0];

	if (!row || row.realm !== 'author') return null;
	if (row.expiresAt.getTime() <= Date.now()) {
		await db.delete(sessions).where(eq(sessions.id, row.id));
		return null;
	}

	return { id: row.id, createdAt: row.createdAt, expiresAt: row.expiresAt };
}

/** Destroys the author session matching the raw token (logout). Unknown tokens are a no-op. */
export async function destroySession(token: string): Promise<void> {
	await getDb()
		.delete(sessions)
		.where(eq(sessions.tokenHash, hashToken(token)));
}

/* -------------------------------------------------------------------------- */
/* Reader realm                                                                */
/* -------------------------------------------------------------------------- */

export interface CreateReaderSessionInput {
	shareId: string;
	reportId: string;
	readerIdentityId: string;
}

/**
 * Creates a reader-realm session bound to one share/report (per-share scope).
 * The token reaches the caller once (the `acta_reader` cookie); only its hash is
 * stored. By default the session has NO expiry (`expires_at` is null): access is
 * governed by the share, which the gate re-checks on every load. When the
 * operator sets READER_SESSION_TTL, the session also ages out after that many
 * days. The access-records audit row is written by the verification flow, not
 * here, so this stays a pure session-store concern (the caller owns the
 * find-or-create identity + audit).
 */
export async function createReaderSession(
	input: CreateReaderSessionInput
): Promise<CreatedReaderSession> {
	const token = randomBytes(TOKEN_BYTES).toString('base64url');
	const ttlMs = readerSessionTtlMs();
	const expiresAt = ttlMs === null ? null : new Date(Date.now() + ttlMs);

	await getDb()
		.insert(readerSessions)
		.values({
			id: uuidv7(),
			tokenHash: hashToken(token),
			shareId: input.shareId,
			reportId: input.reportId,
			readerIdentityId: input.readerIdentityId,
			expiresAt
		});

	return { token, expiresAt };
}

/**
 * Resolves a raw token to a live reader session for a SPECIFIC share. A session
 * verified for another share returns null even with a valid token (per-share
 * scope, NFR12): the share id is part of the validation, not just the token. A
 * null `expires_at` (the default) NEVER expires - the share governs access. A
 * non-null `expires_at` (the operator TTL override) is deleted on sight once
 * past.
 */
export async function validateReaderSession(
	token: string,
	shareId: string
): Promise<ReaderSession | null> {
	const db = getDb();
	const rows = await db
		.select()
		.from(readerSessions)
		.where(eq(readerSessions.tokenHash, hashToken(token)))
		.limit(1);
	const row = rows[0];

	if (!row) return null;
	if (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()) {
		await db.delete(readerSessions).where(eq(readerSessions.id, row.id));
		return null;
	}
	// Per-share binding: a token valid for another share does not authorize this
	// one. Checked AFTER the expiry sweep so a stale row is still cleaned up.
	if (row.shareId !== shareId) return null;

	return {
		id: row.id,
		shareId: row.shareId,
		reportId: row.reportId,
		readerIdentityId: row.readerIdentityId,
		createdAt: row.createdAt,
		expiresAt: row.expiresAt
	};
}

/** Destroys the reader session matching the raw token. Unknown tokens are a no-op. */
export async function destroyReaderSession(token: string): Promise<void> {
	await getDb()
		.delete(readerSessions)
		.where(eq(readerSessions.tokenHash, hashToken(token)));
}

/**
 * Revokes every reader session bound to a share (story 3.5 consumes this when a
 * share is revoked, so an already-verified reader loses access immediately).
 * Exposed now as the seam; defined here because the reader-session table is this
 * module's concern.
 */
export async function destroyReaderSessionsForShare(shareId: string): Promise<void> {
	await getDb().delete(readerSessions).where(eq(readerSessions.shareId, shareId));
}
