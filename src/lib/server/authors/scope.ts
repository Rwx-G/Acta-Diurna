/**
 * Author scope (Epic 8, story 8.2): the resolved owner context threaded through
 * every owning service entry point so a read or write only ever touches its
 * author's resources (tenancy filtering - the multi-author IDOR fix).
 *
 * The scope is a small value, not a behavior: a service receives it and asks
 * `ownerFilter(scope, table.ownerId)` for the owner predicate to AND into its
 * WHERE clause. The MODE decides whether that predicate exists:
 *
 *  - SINGLE mode: exactly one implicit author owns everything, so the owner
 *    predicate is a NO-OP. `ownerFilter` returns `undefined` and the query shape
 *    is BYTE-IDENTICAL to today - single mode behavior is unchanged and existing
 *    tests pass without touching their drizzle mocks.
 *  - MULTI mode: the predicate is `eq(ownerId, scope.authorId)`, ANDed into every
 *    read/write so another author's rows are invisible (list) and a cross-author
 *    id access returns the same not-found the service already raises (no
 *    existence oracle).
 *
 * New rows always carry `scope.authorId` as their owner regardless of mode (the
 * `ownerForInsert` helper), so a single-mode row is owned by the implicit author
 * and a multi-mode row by its creating author - the column is never null on a
 * live row.
 */
import { eq, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { isMultiAuthor } from '$lib/server/mode';

/** The resolved owner context: which author the current request acts as. */
export interface AuthorScope {
	authorId: string;
}

/**
 * The owner predicate to AND into a query's WHERE, or `undefined` in single mode
 * (the no-op: one implicit author owns everything, so no filtering changes the
 * result and the SQL stays byte-identical to the pre-8.2 shape). Pass the owning
 * table's `owner_id` column.
 */
export function ownerFilter(scope: AuthorScope, ownerColumn: PgColumn): SQL | undefined {
	if (!isMultiAuthor()) return undefined;
	return eq(ownerColumn, scope.authorId);
}

/**
 * The owner id to stamp on a new row. Always the scope's author (the implicit
 * author in single mode, the creating author in multi mode) so the column is
 * never null on a live row - the boot inheritance backfills only PRE-8.2 rows.
 */
export function ownerForInsert(scope: AuthorScope): string {
	return scope.authorId;
}
