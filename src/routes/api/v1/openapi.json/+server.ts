import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildOpenApiDocument } from '$lib/server/openapi';

/**
 * `GET /api/v1/openapi.json` (D8) - the OpenAPI 3.1 description of the `/api/v1`
 * surface. PUBLIC by design (allowlisted in `isPublicApiPath`): a spec is a
 * discovery document that leaks no report data, consistent with the 4.3 public
 * `/api/v1/schema`. The endpoints it describes are all PAT-authenticated.
 */
export const GET: RequestHandler = () => {
	return json(buildOpenApiDocument());
};
