/**
 * Access audit query (Epic 6, story 6.3, FR24): the author's view of who opened
 * which of THEIR reports, when. One row per recorded access (`access_records`,
 * written by the reader gate since Epic 3), joined to the reader's identity (the
 * email) and the report (the title), filterable by report and by reader.
 *
 * Owner-scoped (Epic 8): an author sees ONLY accesses to reports they own. The
 * scope ANDs `reports.owner_id = scope.authorId` into the join (multi mode); in
 * single mode the owner predicate is a no-op (one implicit author owns
 * everything) and the query shape is byte-identical. A `reportId` or `readerId`
 * filter that names a row owned by another author yields the same empty result
 * as an unknown id - no cross-owner leak, no existence oracle.
 *
 * GDPR framing: this is the author's own readers' access to the author's own
 * reports. Retention (`purgeAccessRecords`, purge.ts) bounds how long these rows
 * are kept; this query only reads them.
 */
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { ownerFilter, type AuthorScope } from '$lib/server/authors';
import { getDb } from '$lib/server/db/client';
import { accessRecords, readerIdentities, reports } from '$lib/server/db/schema';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Safety ceiling on the audit-log query (mirrors the reports/data-sets list
 * caps). The view has no pagination yet; this bounds the scan so an instance
 * that accumulates many accesses cannot degrade the audit page unboundedly.
 * Newest-first, so the cap keeps the most recent accesses, which is what the
 * author looks at first. It is a guard, not a page size.
 */
export const MAX_ACCESS_RECORDS_LISTED = 500;

/** One audit-log line: a reader's access to one owned report, with the timestamp. */
export interface AccessLogEntry {
	id: string;
	reportId: string;
	reportTitle: string;
	readerIdentityId: string;
	readerEmail: string;
	accessedAt: Date;
}

/** Optional narrowing of the audit log by report and/or reader (both owner-checked). */
export interface AccessLogFilter {
	reportId?: string;
	readerId?: string;
}

/**
 * Reads the access log for the scope's author, newest first, capped at
 * {@link MAX_ACCESS_RECORDS_LISTED}. The join to `reports` is where ownership is
 * enforced: the owner predicate (multi mode) ANDs onto `reports.owner_id`, so a
 * record whose report belongs to another author never appears. The optional
 * `reportId`/`readerId` filters AND further; a malformed filter id is treated as
 * "no match" (an empty result), never a cast error.
 */
export async function listAccessRecords(
	scope: AuthorScope,
	filter: AccessLogFilter = {}
): Promise<AccessLogEntry[]> {
	// A malformed filter id matches nothing - the same empty result a cross-owner
	// or unknown id yields, so a bad id is never a 500 nor an oracle.
	if (filter.reportId !== undefined && !UUID_PATTERN.test(filter.reportId)) return [];
	if (filter.readerId !== undefined && !UUID_PATTERN.test(filter.readerId)) return [];

	const predicates: SQL[] = [];
	const owner = ownerFilter(scope, reports.ownerId);
	if (owner) predicates.push(owner);
	if (filter.reportId !== undefined) predicates.push(eq(accessRecords.reportId, filter.reportId));
	if (filter.readerId !== undefined) {
		predicates.push(eq(accessRecords.readerIdentityId, filter.readerId));
	}

	let query = getDb()
		.select({
			id: accessRecords.id,
			reportId: accessRecords.reportId,
			reportTitle: reports.title,
			readerIdentityId: accessRecords.readerIdentityId,
			readerEmail: readerIdentities.email,
			accessedAt: accessRecords.accessedAt
		})
		.from(accessRecords)
		.innerJoin(reports, eq(accessRecords.reportId, reports.id))
		.innerJoin(readerIdentities, eq(accessRecords.readerIdentityId, readerIdentities.id))
		.$dynamic();

	if (predicates.length > 0) {
		query = query.where(predicates.length === 1 ? predicates[0] : and(...predicates));
	}

	return query.orderBy(desc(accessRecords.accessedAt)).limit(MAX_ACCESS_RECORDS_LISTED);
}

/** Reports the scope's author owns, for the audit-view report filter (id + title). */
export async function listOwnedReportOptions(
	scope: AuthorScope
): Promise<{ id: string; title: string }[]> {
	const owner = ownerFilter(scope, reports.ownerId);
	const projection = { id: reports.id, title: reports.title };
	if (!owner) {
		return getDb()
			.select(projection)
			.from(reports)
			.orderBy(desc(reports.updatedAt))
			.limit(MAX_ACCESS_RECORDS_LISTED);
	}
	return getDb()
		.select(projection)
		.from(reports)
		.where(owner)
		.orderBy(desc(reports.updatedAt))
		.limit(MAX_ACCESS_RECORDS_LISTED);
}
