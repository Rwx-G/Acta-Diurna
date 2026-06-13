/**
 * Legacy ownership inheritance (Epic 8, story 8.2). The 0013 migration adds the
 * `owner_id` columns NULLABLE so the DDL is safe against pre-existing rows; this
 * boot step then BACKFILLS every null owner to the correct author. It cannot live
 * in the SQL migration because the target author is a function of the runtime env
 * (the resolved mode + `INITIAL_OWNER_EMAIL`), which SQL has no access to.
 *
 * Determinism + one-time-ness without a flag: the backfill assigns to the SINGLE
 * implicit author, which is keyed on `INITIAL_OWNER_EMAIL` when set (so the first
 * MULTI boot inherits to that email) and on the reserved sentinel otherwise (pure
 * single mode). The UPDATE is `WHERE owner_id IS NULL`, so:
 *
 *  - it is idempotent: a second boot finds no null rows and updates nothing;
 *  - it never orphans a row: every legacy row gets an owner on the first boot;
 *  - there is no "claim" race: the target is deterministic from the env, not a
 *    first-writer-wins assignment.
 *
 * It runs on EVERY boot (after migrations, before traffic) because that is the
 * cheapest correct trigger: when there is nothing to backfill it is three
 * zero-row UPDATEs. A row inserted by the running app already carries its owner
 * (the services stamp `ownerForInsert`), so only genuine pre-8.2 rows are ever
 * null and eligible.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '$lib/server/db/client';
import { apiTokens, dataSets, reports, sessions, skeletons } from '$lib/server/db/schema';
import { logger } from '$lib/server/logger';
import { isMultiAuthor } from '$lib/server/mode';
import { ensureImplicitAuthor } from './identity';

/**
 * Assigns every owner-less report, data set, skeleton, and API token to the
 * implicit author. Seeds the implicit author first (so the FK target exists), then
 * runs the four guarded UPDATEs. Returns the number of rows inherited per table for
 * the boot log.
 */
export async function inheritLegacyOwnership(): Promise<{
	authorId: string;
	reports: number;
	dataSets: number;
	skeletons: number;
	apiTokens: number;
}> {
	const authorId = await ensureImplicitAuthor();
	const db = getDb();

	const inheritedReports = await db
		.update(reports)
		.set({ ownerId: authorId })
		.where(isNull(reports.ownerId))
		.returning({ id: reports.id });

	const inheritedDataSets = await db
		.update(dataSets)
		.set({ ownerId: authorId })
		.where(isNull(dataSets.ownerId))
		.returning({ id: dataSets.id });

	const inheritedSkeletons = await db
		.update(skeletons)
		.set({ ownerId: authorId })
		.where(isNull(skeletons.ownerId))
		.returning({ id: skeletons.id });

	const inheritedTokens = await db
		.update(apiTokens)
		.set({ ownerId: authorId })
		.where(isNull(apiTokens.ownerId))
		.returning({ id: apiTokens.id });

	const counts = {
		authorId,
		reports: inheritedReports.length,
		dataSets: inheritedDataSets.length,
		skeletons: inheritedSkeletons.length,
		apiTokens: inheritedTokens.length
	};
	if (counts.reports + counts.dataSets + counts.skeletons + counts.apiTokens > 0) {
		logger.info(counts, 'legacy ownership inherited by the initial owner');
	}
	return counts;
}

/**
 * Purges stale null-author author sessions on a multi-mode boot (story 8.3
 * security fix). A pre-flip password author session carries `author_id = NULL`
 * (single mode minted no per-author identity); after SMTP is enabled the instance
 * is multi mode, where `resolveAuthorScope(null)` falls back to the implicit
 * (now INITIAL_OWNER) author - so a stale null-author session would act as the
 * initial owner WITHOUT the magic-link proof. Deleting these sessions forces a
 * fresh magic-link sign-in after the flip.
 *
 * Single mode is a NO-OP: a null author id is the legitimate single-mode shape, so
 * the purge runs ONLY in multi mode. Idempotent: a second multi boot finds no
 * null-author author sessions to delete. Reader/PAT sessions live in other tables;
 * real-author sessions carry a non-null author id and are untouched.
 */
export async function purgeStaleNullAuthorSessions(): Promise<number> {
	if (!isMultiAuthor()) return 0;
	const deleted = await getDb()
		.delete(sessions)
		.where(and(eq(sessions.realm, 'author'), isNull(sessions.authorId)))
		.returning({ id: sessions.id });
	if (deleted.length > 0) {
		logger.info({ purged: deleted.length }, 'stale null-author sessions purged on multi-mode boot');
	}
	return deleted.length;
}
