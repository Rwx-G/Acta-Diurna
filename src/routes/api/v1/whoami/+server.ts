import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Minimal authenticated API endpoint (D8/D10): returns the identity of the PAT
 * the caller authenticated with. A script/agent hits this to confirm its bearer
 * token is accepted before driving the real endpoints (4.2/4.3). It also anchors
 * the realm: it is reachable ONLY with a valid `Authorization: Bearer` token -
 * the apiAuth hook 401s a missing/invalid/revoked bearer, and a cookie never
 * reaches here (strict separation). `locals.apiIdentity` is non-null by the time
 * this runs (the hook guarantees it for a non-public API path).
 */
export const GET: RequestHandler = ({ locals }) => {
	return json({ tokenId: locals.apiIdentity?.tokenId ?? null });
};
