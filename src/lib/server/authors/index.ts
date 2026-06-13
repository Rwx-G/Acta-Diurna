/**
 * Author identity + ownership domain (Epic 8, story 8.2). The author model, the
 * scope threaded through owning services for tenancy filtering, the request-to-
 * scope resolvers, and the boot-time legacy inheritance.
 */
export {
	SINGLE_AUTHOR_EMAIL,
	implicitAuthorEmail,
	ensureAuthor,
	ensureImplicitAuthor,
	implicitAuthorId,
	__resetImplicitAuthorCache
} from './identity.ts';
export { ownerFilter, ownerForInsert } from './scope.ts';
export type { AuthorScope } from './scope.ts';
export { resolveAuthorScope, resolveApiAuthorScope } from './resolve.ts';
export { inheritLegacyOwnership } from './inheritance.ts';
