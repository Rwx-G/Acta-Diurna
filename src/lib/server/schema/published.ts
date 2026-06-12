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

/** Composes `{ version, schema, examples }` for the current document version. */
export function getPublishedSchema(): PublishedSchema {
	return {
		version: CURRENT_SCHEMA_VERSION,
		schema: toJsonSchema(),
		examples: { minimal: minimalDocument, full: fullDocument }
	};
}
