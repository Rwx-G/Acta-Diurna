import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { uuidv7 } from '../db/ids';
import { sessions } from '../db/schema';

/**
 * Author sessions use a fixed 7-day expiry (no sliding renewal): the author
 * is a single known user, and a hard upper bound on session lifetime is
 * simpler to reason about than refresh-on-activity.
 */
export const AUTHOR_SESSION_TTL_MS: number = 7 * 24 * 60 * 60 * 1000;

export interface AuthorSession {
	id: string;
	createdAt: Date;
	expiresAt: Date;
}

export interface CreatedSession {
	token: string;
	expiresAt: Date;
}

function hashToken(token: string): string {
	// D5: tokens are hashed at rest; a database leak exposes no usable token.
	return createHash('sha256').update(token).digest('hex');
}

/**
 * Creates an author-realm session: a 256-bit random token goes to the caller
 * (cookie), only its SHA-256 hash is stored.
 */
export async function createAuthorSession(): Promise<CreatedSession> {
	const token = randomBytes(32).toString('base64url');
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

/** Destroys the session matching the raw token (logout). Unknown tokens are a no-op. */
export async function destroySession(token: string): Promise<void> {
	await getDb()
		.delete(sessions)
		.where(eq(sessions.tokenHash, hashToken(token)));
}
