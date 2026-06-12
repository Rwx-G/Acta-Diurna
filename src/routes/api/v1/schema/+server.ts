import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { CURRENT_SCHEMA_VERSION, toJsonSchema } from '$lib/schema';
import { fullDocument } from '$lib/schema/examples/full';
import { minimalDocument } from '$lib/schema/examples/minimal';
import { runApi } from '$lib/server/api';

/**
 * `GET /api/v1/schema` (AR2; FR31 groundwork) - the published JSON Schema of the
 * CURRENT document version, the agent-discoverable read surface Epic 5's MCP
 * discovery (Story 5.1) consumes. PUBLIC, no PAT (allowlisted in
 * `isPublicApiPath`): the schema is the published contract - already shipped in
 * `/static/schema/v1.json` - so it leaks no report data, consistent with the
 * 4.2 public `/api/v1/openapi.json`.
 *
 * The body is `{ version, schema, examples }`:
 *   - `version`  - `CURRENT_SCHEMA_VERSION` (the 1.2 registry head).
 *   - `schema`   - the live `toJsonSchema()` draft-2020-12 export, which the 1.2
 *                  drift test proves byte-equal to the committed
 *                  `static/schema/v1.json`, so the served schema cannot drift
 *                  from the artifact while keeping a single source of truth.
 *   - `examples` - the 1.2 `minimal` and `full` example documents, so a producer
 *                  sees a concrete valid document, not just the schema.
 *
 * Cacheable per version (the schema is immutable for a given version), unlike the
 * reader's `no-store` neutral pages. Wrapped in `runApi` for consistency with
 * every other `/api/v1` endpoint (it does not throw in practice).
 */
export const GET: RequestHandler = () =>
	runApi(async () =>
		json(
			{
				version: CURRENT_SCHEMA_VERSION,
				schema: toJsonSchema(),
				examples: { minimal: minimalDocument, full: fullDocument }
			},
			{ headers: { 'Cache-Control': 'public, max-age=3600' } }
		)
	);
