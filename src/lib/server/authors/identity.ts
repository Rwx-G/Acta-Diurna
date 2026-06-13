/**
 * Author identity resolution (Epic 8, story 8.2). An author is the OWNER of
 * reports, data sets, and API tokens. Identity = email.
 *
 * In SINGLE mode there is exactly ONE implicit author - the password author -
 * who owns everything. It is seeded once at boot under a RESERVED sentinel email
 * (`SINGLE_AUTHOR_EMAIL`) whose local part (`__single__`) is not a plausible
 * submitted address, so a real magic-link author can never collide with it. When
 * `INITIAL_OWNER_EMAIL` is set (even in single mode, e.g. the operator has
 * pre-declared the future owner), the implicit author is seeded under THAT email
 * instead, so flipping SMTP on later does not re-key ownership.
 *
 * In MULTI mode each magic-link author is its own row, minted on first sign-in
 * (story 8.3). This module provides the SEAM story 8.3 fills: `resolveAuthorId`
 * returns the implicit author today; once 8.3 lands an author session, multi mode
 * reads the authenticated author from it.
 */
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db/client';
import { uuidv7 } from '$lib/server/db/ids';
import { authors } from '$lib/server/db/schema';
import { serverEnv } from '$lib/server/env';
import { normalizeEmail } from '$lib/server/reader/email';

/**
 * Reserved sentinel email for the single-mode implicit author. The `__single__`
 * local part and the `.invalid` reserved TLD (RFC 6761) guarantee no real
 * submitted address normalizes to this value, so the implicit author is a
 * canonical, collision-free identity even alongside multi-mode author rows.
 */
export const SINGLE_AUTHOR_EMAIL = '__single__@acta.invalid';

/**
 * The email the implicit author is keyed on. `INITIAL_OWNER_EMAIL` when the
 * operator has declared it (so single -> multi never re-keys ownership), else the
 * reserved sentinel. Normalized so it matches the canonical-email unique index.
 */
export function implicitAuthorEmail(): string {
	const declared = serverEnv().INITIAL_OWNER_EMAIL;
	return normalizeEmail(declared ?? SINGLE_AUTHOR_EMAIL);
}

/**
 * Returns the author id for `email`, minting the row if it does not exist yet.
 * Idempotent and concurrency-safe: a unique violation on the email index (a
 * racing insert) falls back to the read, so two boots never create two rows for
 * one email. The email is normalized by the caller boundary; pass a canonical
 * value.
 */
export async function ensureAuthor(email: string): Promise<string> {
	const db = getDb();
	const existing = await db
		.select({ id: authors.id })
		.from(authors)
		.where(eq(authors.email, email))
		.limit(1);
	if (existing.length > 0) return existing[0].id;

	const id = uuidv7();
	try {
		await db.insert(authors).values({ id, email, createdAt: new Date() });
		return id;
	} catch {
		// A concurrent boot won the insert race on the unique email index; read the
		// row it created rather than failing the seed.
		const row = await db
			.select({ id: authors.id })
			.from(authors)
			.where(eq(authors.email, email))
			.limit(1);
		if (row.length > 0) return row[0].id;
		throw new Error(`failed to ensure author for ${email}`);
	}
}

/**
 * Ensures the single implicit author exists and returns its id. The boot path
 * (db/migrate or the init hook) calls this once so single-mode ownership has a
 * row to point at before any request runs.
 */
export function ensureImplicitAuthor(): Promise<string> {
	return ensureAuthor(implicitAuthorEmail());
}

/**
 * The display email for an author id, or null when the id is unknown OR resolves
 * to the implicit author (story 8.6). The implicit author's email is a reserved
 * sentinel (`SINGLE_AUTHOR_EMAIL`) or the operator's `INITIAL_OWNER_EMAIL`; in
 * single mode it is never a real signed-in identity, so it is hidden here. This
 * is what the workspace surfaces near logout in multi mode (the logged-in
 * author's email) and what stays null in single mode (the password author is
 * anonymous - no identity is shown).
 */
export async function authorDisplayEmail(id: string): Promise<string | null> {
	const rows = await getDb()
		.select({ email: authors.email })
		.from(authors)
		.where(eq(authors.id, id))
		.limit(1);
	const email = rows[0]?.email;
	if (email === undefined || email === SINGLE_AUTHOR_EMAIL) return null;
	return email;
}

let implicitAuthorIdCache: string | undefined;

/**
 * The single implicit author's id, cached after the first resolution. Seeded at
 * boot (`ensureImplicitAuthor`) so this read always hits an existing row. The
 * cache is process-local and never invalidated - the implicit author is stable
 * for the life of the instance.
 */
export async function implicitAuthorId(): Promise<string> {
	return (implicitAuthorIdCache ??= await ensureImplicitAuthor());
}

/** Test support only: drops the cached implicit author id so a fresh resolution runs. */
export function __resetImplicitAuthorCache(): void {
	implicitAuthorIdCache = undefined;
}
