import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, validateDocument } from '$lib/schema';
import { GET } from './+server';

function get(): Parameters<typeof GET>[0] {
	return {} as unknown as Parameters<typeof GET>[0];
}

describe('GET /api/v1/schema', () => {
	it('returns { version, schema, examples } (200) with the current version', async () => {
		const response = await GET(get());
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			version: number;
			schema: { $schema: string };
			examples: { minimal: unknown; full: unknown; drilldown: unknown };
		};
		expect(body.version).toBe(CURRENT_SCHEMA_VERSION);
		expect(body.schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
		expect(body.examples.minimal).toBeDefined();
		expect(body.examples.full).toBeDefined();
		expect(body.examples.drilldown).toBeDefined();
	});

	it('serves the schema without drifting from the committed static/schema/v1.json', async () => {
		const response = await GET(get());
		const body = (await response.json()) as { schema: unknown };
		const committed: unknown = JSON.parse(readFileSync('static/schema/v1.json', 'utf8'));
		expect(body.schema).toEqual(committed);
	});

	it('ships examples that are valid documents against the schema', async () => {
		const response = await GET(get());
		const body = (await response.json()) as {
			examples: { minimal: unknown; full: unknown; drilldown: unknown };
		};
		expect(validateDocument(body.examples.minimal).ok).toBe(true);
		expect(validateDocument(body.examples.full).ok).toBe(true);
		expect(validateDocument(body.examples.drilldown).ok).toBe(true);
	});

	it('ships a drill-down example with a detail page reached by an internal link (Story 11.5)', async () => {
		// An agent discovering the shape reads the examples: the drill-down example
		// must show a `kind: 'detail'` section reached by a `linkTo`, so the in-report
		// drill-down is discoverable, not just describable in the schema.
		const response = await GET(get());
		const body = (await response.json()) as { examples: { drilldown: unknown } };
		const result = validateDocument(body.examples.drilldown);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const detail = result.document.sections.find((section) => section.kind === 'detail');
		expect(detail).toBeDefined();
		const table = result.document.sections
			.flatMap((section) => section.blocks)
			.find((block) => block.type === 'table');
		expect(table?.type === 'table' && table.rowLinks).toContain(detail!.id);
	});

	it('sets a cacheable Cache-Control header (immutable per version)', async () => {
		const response = await GET(get());
		expect(response.headers.get('cache-control')).toContain('public');
	});
});
