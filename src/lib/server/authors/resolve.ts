/**
 * Author-scope resolution from a request context (Epic 8, story 8.2). This is
 * the ONE place a route turns "the current request" into an `AuthorScope` the
 * owning services filter by. Both the cookie realm (workspace) and the PAT realm
 * (REST/MCP) resolve through here so the owner predicate has a single source.
 *
 * Resolution by realm:
 *
 *  - SINGLE mode: there is only ever the implicit author, so this is exact in
 *    every case - the session/PAT author id is IGNORED (one implicit author owns
 *    everything, the column stays null, the owner predicate is a no-op).
 *  - MULTI mode: the cookie realm reads the author id the magic-link session
 *    carries (story 8.3), and the PAT realm reads the token's owner (8.2). A live
 *    multi-mode session always carries a real author id; the implicit-author
 *    fallback below is defensive (a single-mode password session, or a not-yet-
 *    populated id, never reaches multi-mode owner filtering).
 */
import { isMultiAuthor } from '$lib/server/mode';
import type { ApiIdentity } from '$lib/server/auth/api-tokens';
import { implicitAuthorId } from './identity';
import type { AuthorScope } from './scope';

/**
 * Resolves the cookie-realm (workspace) author scope. `authorId` is the author the
 * current session authenticated - `locals.authorSession.authorId`, populated only
 * by a multi-mode magic-link sign-in (story 8.3). In multi mode a non-null id is
 * the scope; in single mode (or a null id) the scope is the implicit author. This
 * is what carries the logged-in author into 8.2's owner filtering, making tenancy
 * real.
 */
export async function resolveAuthorScope(authorId?: string | null): Promise<AuthorScope> {
	if (isMultiAuthor() && authorId) return { authorId };
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
