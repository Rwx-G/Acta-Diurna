/**
 * The published-schema composition (FR31), the SINGLE code path the public REST
 * `/api/v1/schema` endpoint (4.3) and the MCP `get_schema` tool (5.1) both call.
 * Extracted so the MCP-advertised schema cannot drift from the REST artifact:
 * one composition, two surfaces. The 1.2 drift test proves `toJsonSchema()`
 * byte-equal to the committed `static/schema/v1.json`, so this stays in sync with
 * the static artifact too.
 */
import { CURRENT_SCHEMA_VERSION, toJsonSchema } from '$lib/schema';
import { fullDocument } from '$lib/schema/examples/full';
import { minimalDocument } from '$lib/schema/examples/minimal';

export interface PublishedSchema {
	version: number;
	schema: Record<string, unknown>;
	examples: { minimal: unknown; full: unknown };
}

/**
 * Memoized published schema. `toJsonSchema()` re-derives the whole JSON Schema
 * from the Zod graph on every call, and the MCP `get_schema` tool is
 * stateless-per-request, so an agent hitting it rebuilds the schema each time.
 * The composition is STABLE for the life of the process (the Zod graph and the
 * examples are module constants), so it is derived once on the first call and the
 * same object is returned thereafter - no eviction is needed. The REST
 * `/api/v1/schema` endpoint and the MCP `get_schema` tool both call
 * `getPublishedSchema`, so both benefit from the single derivation.
 */
let cached: PublishedSchema | undefined;

/** Composes `{ version, schema, examples }` for the current document version. */
export function getPublishedSchema(): PublishedSchema {
	return (cached ??= {
		version: CURRENT_SCHEMA_VERSION,
		schema: toJsonSchema(),
		examples: { minimal: minimalDocument, full: fullDocument }
	});
}
