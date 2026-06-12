/**
 * Ephemeral-state purge (3.3 penetration audit, Medium DoS). Two tables grow
 * with attacker traffic up to the rate-limit ceiling and carry no audit value
 * once spent: in-flight verification tokens, and uploaded data sets that were
 * never bound to a report and have aged past the retention grace window. A
 * periodic sweep (registered at boot in hooks.server.ts) keeps both bounded.
 *
 * Each function is pure over its `db` argument so it is individually testable,
 * and returns the number of rows it removed for the sweep to log.
 *
 * NOT purged here: `access_records`. Audit-trail retention (FR24) is governed by
 * Epic 6 story 6.3 ("Access Audit & Retention"), a deliberate retention policy,
 * not a blind time-based janitor. Adding it here would silently destroy audit
 * history; leave it to 6.3.
 */
import { unlink } from 'node:fs/promises';
import { and, isNull, lt, or, isNotNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { dataSets, verificationTokens } from '$lib/server/db/schema';
import type * as schema from '$lib/server/db/schema';
import { serverEnv } from '$lib/server/env';
import { logger } from '$lib/server/logger';

type Db = NodePgDatabase<typeof schema>;

/** Default retention grace for an unbound data set before it counts as orphaned. */
export const DEFAULT_ORPHAN_RETENTION_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The instant before which an unbound data set is an orphan: `now` minus the
 * retention grace. A set injected at exactly the cutoff is NOT collected (the
 * predicate is strict `<`), so the boundary is inclusive of the grace window.
 */
export function orphanCutoff(now: Date, retentionDays: number): Date {
	return new Date(now.getTime() - retentionDays * MS_PER_DAY);
}

/**
 * Deletes spent or expired verification tokens: `consumed_at` set (single-use
 * already burned) OR `expires_at` in the past. These are dead in-flight tokens
 * with no audit value. Returns the number of rows removed.
 */
export async function purgeVerificationTokens(db: Db, now: Date): Promise<number> {
	const deleted = await db
		.delete(verificationTokens)
		.where(or(isNotNull(verificationTokens.consumedAt), lt(verificationTokens.expiresAt, now)))
		.returning({ id: verificationTokens.id });
	return deleted.length;
}

/**
 * Deletes data sets that are truly abandoned - `report_id IS NULL` AND injected
 * before `now - retentionDays` - and unlinks each one's stored file from the
 * uploads volume.
 *
 * `report_id IS NULL` alone is a LEGITIMATE state (a data set can precede or
 * outlive a report, per the schema), so it is the GRACE WINDOW that distinguishes
 * a freshly-uploaded-but-unbound set from an orphan: only an unbound set older
 * than the window is collected. A missing file is tolerated (ENOENT): the row is
 * still removed so a half-cleaned state self-heals. Returns the number of rows
 * removed.
 */
export async function purgeOrphanDataSets(
	db: Db,
	now: Date,
	retentionDays: number
): Promise<number> {
	const cutoff = orphanCutoff(now, retentionDays);
	const deleted = await db
		.delete(dataSets)
		.where(and(isNull(dataSets.reportId), lt(dataSets.injectedAt, cutoff)))
		.returning({ storagePath: dataSets.storagePath });

	for (const row of deleted) {
		await unlinkTolerant(row.storagePath);
	}
	return deleted.length;
}

/** Unlinks a stored file, treating an already-missing file as success (ENOENT). */
async function unlinkTolerant(storagePath: string): Promise<void> {
	try {
		await unlink(storagePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
		throw error;
	}
}

/** Resolves the orphan retention window from the environment (default 30 days). */
export function orphanRetentionDays(): number {
	return serverEnv().DATA_SET_ORPHAN_RETENTION_DAYS ?? DEFAULT_ORPHAN_RETENTION_DAYS;
}

/**
 * Runs one full sweep: spent verification tokens, then orphaned data sets. Logs
 * the removed counts. Errors are logged, not thrown, so a single failing sweep
 * never crashes the long-running interval that drives it.
 */
export async function runPurgeSweep(db: Db, now: Date = new Date()): Promise<void> {
	try {
		const tokens = await purgeVerificationTokens(db, now);
		const orphans = await purgeOrphanDataSets(db, now, orphanRetentionDays());
		logger.info({ verificationTokens: tokens, orphanDataSets: orphans }, 'purge sweep complete');
	} catch (error) {
		logger.error({ err: error }, 'purge sweep failed');
	}
}
