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
 * Access-record retention (Epic 6 story 6.3, FR24/FR38/NFR11): `access_records`
 * IS swept here now, but ONLY when `ACCESS_RECORD_RETENTION_DAYS` is set. Unset
 * = the audit trail is KEPT indefinitely (the conservative default: never
 * silently destroy audit history). When set, records older than the window are
 * deleted - a deliberate, configurable retention policy, not a blind janitor.
 */
import { unlink } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { and, isNull, lt, or, isNotNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { accessRecords, dataSets, verificationTokens } from '$lib/server/db/schema';
import type * as schema from '$lib/server/db/schema';
import { serverEnv } from '$lib/server/env';
import { logger } from '$lib/server/logger';
import { MS_PER_DAY } from '$lib/server/time';

type Db = NodePgDatabase<typeof schema>;

/** Default retention grace for an unbound data set before it counts as orphaned. */
export const DEFAULT_ORPHAN_RETENTION_DAYS = 30;

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
	// No RETURNING: the sweep only needs the count, so `rowCount` gives it without
	// transferring every deleted id back. (purgeOrphanDataSets DOES need RETURNING,
	// for the storage paths to unlink.)
	const result = await db
		.delete(verificationTokens)
		.where(or(isNotNull(verificationTokens.consumedAt), lt(verificationTokens.expiresAt, now)));
	return result.rowCount ?? 0;
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
 *
 * The DELETE...RETURNING runs first and is the authoritative cleanup; the file
 * unlink is best-effort bookkeeping (CWE-459). Each unlink is isolated so a
 * single un-removable file (EACCES/EBUSY/EIO) never aborts the loop and strands
 * the remaining rows' files - those rows are already gone from the table, so they
 * would never match the orphan predicate again and their files would leak forever.
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

	// Unlink in parallel (E6): the rows are already deleted (the authoritative
	// cleanup), so the unlinks are independent best-effort bookkeeping. Each
	// `unlinkOrphanFile` isolates its own error, so one un-removable file never
	// rejects the batch and strands the rest - the same per-file isolation the
	// sequential loop had, now without serializing the I/O.
	await Promise.all(deleted.map((row) => unlinkOrphanFile(row.storagePath)));
	return deleted.length;
}

/**
 * Unlinks one orphan's stored file. Swallows every error so the sweep always
 * attempts every file (the row is already deleted, so a thrown error here would
 * strand the rest). ENOENT is silent (already-missing self-heals); any other
 * failure is logged at warn with the path so an operator can reclaim the space.
 *
 * Defense-in-depth: the path must resolve under UPLOADS_DIR before any unlink.
 * `storage_path` is server-minted today (a UUID name under UPLOADS_DIR, see
 * ingestion.ts), so this is a cheap invariant guard - never delete a path outside
 * the uploads volume even if a future change or a tampered row let one in.
 */
async function unlinkOrphanFile(storagePath: string): Promise<void> {
	const resolved = resolve(storagePath);
	const uploadsRoot = resolve(serverEnv().UPLOADS_DIR);
	if (!resolved.startsWith(uploadsRoot + sep)) {
		logger.warn({ storagePath }, 'purge: refusing to unlink a path outside UPLOADS_DIR');
		return;
	}

	try {
		await unlink(resolved);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
		logger.warn({ err: error, storagePath }, 'purge: failed to unlink orphan data set file');
	}
}

/** Resolves the orphan retention window from the environment (default 30 days). */
export function orphanRetentionDays(): number {
	return serverEnv().DATA_SET_ORPHAN_RETENTION_DAYS ?? DEFAULT_ORPHAN_RETENTION_DAYS;
}

/**
 * The instant before which an access record is past its retention window: `now`
 * minus `retentionDays`. A record at exactly the cutoff is NOT collected (strict
 * `<`), so the boundary is inclusive of the retention window. Shares the day math
 * with {@link orphanCutoff} but is a distinct policy (audit trail, not orphan).
 */
export function accessRecordCutoff(now: Date, retentionDays: number): Date {
	return new Date(now.getTime() - retentionDays * MS_PER_DAY);
}

/**
 * Deletes access-audit rows older than the retention window (`accessed_at < now -
 * retentionDays`), FR24/FR38/NFR11. Pure over `db` and individually testable;
 * returns the number of rows removed. The CALLER decides whether to run it at all
 * (the sweep skips it entirely when `ACCESS_RECORD_RETENTION_DAYS` is unset), so
 * this function always deletes against the window it is given - it never reads the
 * environment. No RETURNING: the sweep needs only the count.
 */
export async function purgeAccessRecords(
	db: Db,
	now: Date,
	retentionDays: number
): Promise<number> {
	const cutoff = accessRecordCutoff(now, retentionDays);
	const result = await db.delete(accessRecords).where(lt(accessRecords.accessedAt, cutoff));
	return result.rowCount ?? 0;
}

/**
 * The access-record retention window in DAYS, or `undefined` when unset. Unset is
 * the conservative default: the sweep then KEEPS the audit trail indefinitely
 * (story 6.3 - retention is opt-in so an operator never loses audit history by
 * accident). A set value bounds how long accesses are kept (GDPR data
 * minimization).
 */
export function accessRecordRetentionDays(): number | undefined {
	return serverEnv().ACCESS_RECORD_RETENTION_DAYS;
}

/**
 * Runs one full sweep: spent verification tokens, orphaned data sets, then aged
 * access records (only when `ACCESS_RECORD_RETENTION_DAYS` is set - unset KEEPS
 * the audit trail). Logs the removed counts. Errors are logged, not thrown, so a
 * single failing sweep never crashes the long-running interval that drives it.
 */
export async function runPurgeSweep(db: Db, now: Date = new Date()): Promise<void> {
	try {
		const tokens = await purgeVerificationTokens(db, now);
		const orphans = await purgeOrphanDataSets(db, now, orphanRetentionDays());
		const retentionDays = accessRecordRetentionDays();
		const accesses =
			retentionDays === undefined ? 0 : await purgeAccessRecords(db, now, retentionDays);
		logger.info(
			{ verificationTokens: tokens, orphanDataSets: orphans, accessRecords: accesses },
			'purge sweep complete'
		);
	} catch (error) {
		logger.error({ err: error }, 'purge sweep failed');
	}
}
