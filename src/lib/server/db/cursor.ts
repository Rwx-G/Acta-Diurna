/**
 * Keyset (cursor) pagination over a `(timestamp DESC, id DESC)` ordering, shared
 * by every owning list service (story 1.5 follow-up / full-audit C2). The list
 * services were capped full scans (a fixed 500/100 ceiling) with no way to page
 * past the cap; the access-audit log in particular accrued one row per reader
 * access and SILENTLY dropped the oldest past the cap with no signal. This module
 * freezes ONE cursor contract now, while callers are few, so the shape does not
 * later ossify into the REST surface as a breaking change.
 *
 * The contract:
 *  - a service takes an optional `{ limit?, cursor? }` ({@link PageRequest}),
 *  - and returns `{ items, nextCursor }` ({@link Page}). `nextCursor` is null when
 *    the page is the last one, a non-null opaque string otherwise. A caller pages
 *    by echoing the previous `nextCursor` back as `cursor`.
 *
 * Why keyset and not OFFSET: keyset is O(log n) on the `(timestamp, id)` index and
 * is stable under concurrent inserts (a new row never shifts a page boundary and
 * causes a skip/duplicate), which OFFSET cannot guarantee. The `id` (a time-ordered
 * UUIDv7) is the unique tiebreak so two rows sharing a timestamp still order
 * deterministically and the cursor never straddles them.
 *
 * Fetching one extra row (`limit + 1`) is how truncation is SIGNALED rather than
 * silently swallowed: if the extra row comes back there is a next page, so
 * `nextCursor` is the last KEPT row's key; otherwise it is null. The caller (the
 * audit view, the REST list) can then offer "load older" instead of dropping data.
 */
import { and, eq, lt, or, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/** The default page size when a caller passes no `limit` (matches the prior list caps' intent: a bounded page). */
export const DEFAULT_PAGE_SIZE = 100;

/** The hard upper bound on a requested page size, so a caller cannot ask for an unbounded scan. */
export const MAX_PAGE_SIZE = 500;

/** A page request: an optional page size and an optional opaque cursor from a prior page's `nextCursor`. */
export interface PageRequest {
	limit?: number;
	cursor?: string;
}

/** A page of results: the items for this page and the cursor for the next page (null = last page). */
export interface Page<T> {
	items: T[];
	nextCursor: string | null;
}

/** The decoded keyset position: the `(timestamp, id)` of the last row of the previous page. */
interface CursorPosition {
	timestamp: Date;
	id: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Clamps a requested page size into `[1, MAX_PAGE_SIZE]`, defaulting to
 * {@link DEFAULT_PAGE_SIZE} when absent or not a positive integer. A caller can
 * never force an unbounded scan nor a zero/negative page.
 */
export function pageSize(limit: number | undefined): number {
	if (limit === undefined || !Number.isInteger(limit) || limit < 1) return DEFAULT_PAGE_SIZE;
	return Math.min(limit, MAX_PAGE_SIZE);
}

/** Encodes a `(timestamp, id)` position as an opaque, URL-safe cursor string. */
export function encodeCursor(timestamp: Date, id: string): string {
	return Buffer.from(`${timestamp.toISOString()}|${id}`, 'utf8').toString('base64url');
}

/**
 * Decodes an opaque cursor back to its `(timestamp, id)` position, or null when it
 * is malformed (garbage, a non-ISO timestamp, or a non-UUID id). A bad cursor is
 * treated as "start from the top", never a 500 - the same boundary discipline the
 * list services apply to a malformed filter id.
 */
export function decodeCursor(cursor: string | undefined): CursorPosition | null {
	if (cursor === undefined || cursor === '') return null;
	let decoded: string;
	try {
		decoded = Buffer.from(cursor, 'base64url').toString('utf8');
	} catch {
		return null;
	}
	const separator = decoded.indexOf('|');
	if (separator === -1) return null;
	const isoTimestamp = decoded.slice(0, separator);
	const id = decoded.slice(separator + 1);
	if (!UUID_PATTERN.test(id)) return null;
	const timestamp = new Date(isoTimestamp);
	if (Number.isNaN(timestamp.getTime())) return null;
	return { timestamp, id };
}

/**
 * The keyset WHERE predicate for "rows strictly after this position" under a
 * `(timestamp DESC, id DESC)` ordering: `timestamp < t OR (timestamp = t AND id <
 * id)`. Returns undefined when there is no cursor (the first page), so the query
 * adds no predicate and its single-mode shape stays byte-identical. Pass the
 * sort-timestamp column and the id column of the table.
 */
export function cursorPredicate(
	position: CursorPosition | null,
	timestampColumn: PgColumn,
	idColumn: PgColumn
): SQL | undefined {
	if (position === null) return undefined;
	return or(
		lt(timestampColumn, position.timestamp),
		and(eq(timestampColumn, position.timestamp), lt(idColumn, position.id))
	);
}

/**
 * Builds a {@link Page} from a `limit + 1` over-fetch and the key extractor for
 * the kept rows' last element. When the over-fetch returned an extra row there is
 * a further page, so the surplus row is dropped and `nextCursor` encodes the last
 * KEPT row's key; otherwise `nextCursor` is null (the last page). This is the
 * signal that replaces the prior silent drop: a full page always tells the caller
 * whether older rows remain.
 */
export function toPage<T>(
	fetched: T[],
	limit: number,
	key: (row: T) => { timestamp: Date; id: string }
): Page<T> {
	if (fetched.length <= limit) {
		return { items: fetched, nextCursor: null };
	}
	const items = fetched.slice(0, limit);
	const last = key(items[items.length - 1]);
	return { items, nextCursor: encodeCursor(last.timestamp, last.id) };
}
