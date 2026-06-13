/**
 * Author-scope resolution from a request context (Epic 8, story 8.2). This is
 * the ONE place a route turns "the current request" into an `AuthorScope` the
 * owning services filter by. Both the cookie realm (workspace) and the PAT realm
 * (REST/MCP) resolve through here so the owner predicate has a single source.
 *
 * Today every resolution returns the single implicit author:
 *
 *  - SINGLE mode: there is only ever the implicit author, so this is exact.
 *  - MULTI mode: the author SESSION (cookie realm) and the per-author PAT (bearer
 *    realm) do not yet carry an author id - story 8.3 mints author sessions and
 *    8.2's token work associates a PAT with its creating author. Until 8.3
 *    populates a real author, multi mode also resolves to the implicit author.
 *    This keeps 8.2 a pure plumbing change: the SEAM (scope threaded everywhere,
 *    predicate applied) is in place and provably a no-op in single mode; the
 *    multi-author POPULATION lands next.
 */
import type { ApiIdentity } from '$lib/server/auth/api-tokens';
import { implicitAuthorId } from './identity';
import type { AuthorScope } from './scope';

/**
 * Resolves the cookie-realm (workspace) author scope. In single mode this is the
 * implicit author; in multi mode it will read the author session (story 8.3).
 */
export async function resolveAuthorScope(): Promise<AuthorScope> {
	return { authorId: await implicitAuthorId() };
}

/**
 * Resolves the PAT-realm (REST/MCP) author scope from the authenticated API
 * identity. A PAT is per-author: once tokens carry an owner (this story) and
 * multi-author sessions land (8.3), the token's `ownerId` is the scope. Until
 * then a token without a resolved owner falls back to the implicit author, so
 * single mode is exact and multi mode is a no-op pending population.
 */
export async function resolveApiAuthorScope(identity: ApiIdentity): Promise<AuthorScope> {
	if (identity.ownerId !== null) return { authorId: identity.ownerId };
	return { authorId: await implicitAuthorId() };
}
