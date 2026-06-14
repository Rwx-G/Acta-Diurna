import { describe, expect, it, vi } from 'vitest';

// `getPublishedSchema` memoizes its result (3.x performance audit, E2): the JSON
// Schema is re-derived from the Zod graph on every `toJsonSchema()` call and the
// MCP `get_schema` tool is stateless-per-request, so the composition is built
// once and the SAME object is returned thereafter. These tests prove the
// derivation runs once and the returned reference is stable across calls.

const deriveSpy = vi.hoisted(() => vi.fn(() => ({ derived: true })));

vi.mock('$lib/schema', () => ({
	CURRENT_SCHEMA_VERSION: 1,
	toJsonSchema: deriveSpy
}));
vi.mock('$lib/schema/examples/full', () => ({ fullDocument: { full: true } }));
vi.mock('$lib/schema/examples/minimal', () => ({ minimalDocument: { minimal: true } }));
vi.mock('$lib/schema/examples/drilldown', () => ({ drilldownDocument: { drilldown: true } }));

import { getPublishedSchema } from './published';

describe('getPublishedSchema', () => {
	it('derives the schema only once across repeated calls', () => {
		getPublishedSchema();
		getPublishedSchema();
		getPublishedSchema();

		expect(deriveSpy).toHaveBeenCalledTimes(1);
	});

	it('returns a stable reference (the memoized object) on every call', () => {
		const first = getPublishedSchema();
		const second = getPublishedSchema();

		expect(second).toBe(first);
		expect(first).toEqual({
			version: 1,
			schema: { derived: true },
			examples: {
				minimal: { minimal: true },
				full: { full: true },
				drilldown: { drilldown: true }
			}
		});
	});
});
