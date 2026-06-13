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
import { isNull } from 'drizzle-orm';
import { getDb } from '$lib/server/db/client';
import { apiTokens, dataSets, reports } from '$lib/server/db/schema';
import { logger } from '$lib/server/logger';
import { ensureImplicitAuthor } from './identity';

/**
 * Assigns every owner-less report, data set, and API token to the implicit
 * author. Seeds the implicit author first (so the FK target exists), then runs
 * the three guarded UPDATEs. Returns the number of rows inherited per table for
 * the boot log.
 */
export async function inheritLegacyOwnership(): Promise<{
	authorId: string;
	reports: number;
	dataSets: number;
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

	const inheritedTokens = await db
		.update(apiTokens)
		.set({ ownerId: authorId })
		.where(isNull(apiTokens.ownerId))
		.returning({ id: apiTokens.id });

	const counts = {
		authorId,
		reports: inheritedReports.length,
		dataSets: inheritedDataSets.length,
		apiTokens: inheritedTokens.length
	};
	if (counts.reports + counts.dataSets + counts.apiTokens > 0) {
		logger.info(counts, 'legacy ownership inherited by the initial owner');
	}
	return counts;
}
