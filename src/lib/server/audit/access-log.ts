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
import {
	cursorPredicate,
	decodeCursor,
	pageSize,
	toPage,
	type Page,
	type PageRequest
} from '$lib/server/db/cursor';
import { UUID_PATTERN } from '$lib/server/db/ids';
import { accessRecords, readerIdentities, reports } from '$lib/server/db/schema';

/**
 * Safety ceiling on the owned-report dropdown options ({@link listOwnedReportOptions}).
 * That list is a bounded picker (an author's own reports), not a growing log, so it
 * keeps a simple cap rather than a cursor - real catalogues sit far below it. The
 * access LOG itself is cursor-paginated (see {@link listAccessRecords}), because it
 * accrues one row per reader access and must never silently drop the oldest.
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

/** An empty page: the result for an over-owner/unknown filter id or an exhausted log. */
const EMPTY_PAGE: Page<AccessLogEntry> = { items: [], nextCursor: null };

/**
 * Reads a page of the access log for the scope's author, newest first, with
 * keyset (cursor) pagination so the trail is NEVER silently truncated (full-audit
 * C2): the prior fixed 500-row cap dropped the oldest accesses with no signal,
 * losing audit data invisibly. The join to `reports` is where ownership is
 * enforced: the owner predicate (multi mode) ANDs onto `reports.owner_id`, so a
 * record whose report belongs to another author never appears. The optional
 * `reportId`/`readerId` filters AND further; a malformed filter id is treated as
 * "no match" (an empty page), never a cast error.
 *
 * The keyset is `(accessed_at DESC, id DESC)`; `page.cursor` resumes after the
 * previous page's last row. The page fetches `limit + 1` rows: a surplus row sets
 * a non-null `nextCursor` so the caller knows older accesses remain and can offer
 * "load older" instead of dropping them. A malformed cursor is ignored (start from
 * the newest), never an error.
 */
export async function listAccessRecords(
	scope: AuthorScope,
	filter: AccessLogFilter = {},
	page: PageRequest = {}
): Promise<Page<AccessLogEntry>> {
	// A malformed filter id matches nothing - the same empty result a cross-owner
	// or unknown id yields, so a bad id is never a 500 nor an oracle.
	if (filter.reportId !== undefined && !UUID_PATTERN.test(filter.reportId)) return EMPTY_PAGE;
	if (filter.readerId !== undefined && !UUID_PATTERN.test(filter.readerId)) return EMPTY_PAGE;

	const limit = pageSize(page.limit);
	const predicates: SQL[] = [];
	const owner = ownerFilter(scope, reports.ownerId);
	if (owner) predicates.push(owner);
	if (filter.reportId !== undefined) predicates.push(eq(accessRecords.reportId, filter.reportId));
	if (filter.readerId !== undefined) {
		predicates.push(eq(accessRecords.readerIdentityId, filter.readerId));
	}
	const keyset = cursorPredicate(
		decodeCursor(page.cursor),
		accessRecords.accessedAt,
		accessRecords.id
	);
	if (keyset) predicates.push(keyset);

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

	// Tiebreak on id (a time-ordered UUIDv7) so two accesses sharing a timestamp
	// order deterministically and the cursor never straddles them. Fetch limit + 1
	// to detect a further page without a second count query.
	const fetched = await query
		.orderBy(desc(accessRecords.accessedAt), desc(accessRecords.id))
		.limit(limit + 1);
	return toPage(fetched, limit, (row) => ({ timestamp: row.accessedAt, id: row.id }));
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
