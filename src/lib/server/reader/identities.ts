/**
 * Reader identity + access audit (FR22). One global `reader_identities` row per
 * verified email (backlog uniqueness decision); each verified access writes one
 * `access_records` row (many per identity). The email reaching this module is
 * already normalized (boundary concern, `email.ts`), so the unique email index
 * is the canonical identity key.
 */
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db/client';
import { uuidv7 } from '$lib/server/db/ids';
import { accessRecords, readerIdentities, type ReaderIdentityRow } from '$lib/server/db/schema';

/**
 * Finds the identity for a normalized email or creates it, then bumps
 * `last_verified_at`. Returns the identity id. The find-or-create races on the
 * unique email index: a concurrent first-verification of the same email would
 * collide on insert, so the insert uses an idempotent upsert (ON CONFLICT on the
 * email index) that always lands a single row and returns it.
 */
export async function findOrCreateIdentity(normalizedEmail: string): Promise<string> {
	const db = getDb();
	const now = new Date();

	const upserted = (await db
		.insert(readerIdentities)
		.values({
			id: uuidv7(now.getTime()),
			email: normalizedEmail,
			createdAt: now,
			lastVerifiedAt: now
		})
		.onConflictDoUpdate({
			target: readerIdentities.email,
			set: { lastVerifiedAt: now }
		})
		.returning()) as ReaderIdentityRow[];

	return upserted[0].id;
}

/** Writes one access-audit row: this identity reached this report via this share, now. */
export async function recordAccess(
	readerIdentityId: string,
	shareId: string,
	reportId: string
): Promise<void> {
	await getDb().insert(accessRecords).values({
		id: uuidv7(),
		readerIdentityId,
		shareId,
		reportId,
		accessedAt: new Date()
	});
}

/** Reads an identity by normalized email (audit/admin seam); null when unknown. */
export async function getIdentityByEmail(
	normalizedEmail: string
): Promise<ReaderIdentityRow | null> {
	const rows = await getDb()
		.select()
		.from(readerIdentities)
		.where(eq(readerIdentities.email, normalizedEmail))
		.limit(1);
	return rows[0] ?? null;
}
