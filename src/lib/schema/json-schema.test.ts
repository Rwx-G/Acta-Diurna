import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOCUMENT_SCHEMA_VERSION, toJsonSchema } from './index.ts';

type ExportedJsonSchema = {
	$schema: string;
	title: string;
	type: string;
	required: string[];
	properties: {
		version: { type: string; const: number };
		sections: {
			items: {
				properties: {
					blocks: { items: { oneOf: unknown[] } };
				};
			};
		};
	};
};

describe('toJsonSchema', () => {
	it('produces draft 2020-12 with the version identifier 1', () => {
		const schema = toJsonSchema() as ExportedJsonSchema;
		expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
		expect(schema.title).toBe(`Acta Diurna document (schema v${DOCUMENT_SCHEMA_VERSION})`);
		expect(schema.type).toBe('object');
		expect(schema.properties.version).toEqual({ type: 'number', const: 1 });
		expect(schema.required).toEqual(['version', 'title', 'sections']);
	});

	it('describes the five block types as a union', () => {
		const schema = toJsonSchema() as ExportedJsonSchema;
		expect(schema.properties.sections.items.properties.blocks.items.oneOf).toHaveLength(5);
	});

	it('serializes cleanly without zod internals', () => {
		const serialized = JSON.stringify(toJsonSchema());
		expect(serialized).not.toContain('~standard');
		expect(JSON.parse(serialized)).toEqual(toJsonSchema());
	});

	it('matches the committed artifact in static/schema/v1.json', () => {
		const committed: unknown = JSON.parse(readFileSync('static/schema/v1.json', 'utf8'));
		expect(committed).toEqual(toJsonSchema());
	});

	it('publishes the http(s) restriction as a pattern on the link href node', () => {
		type BlockNode = {
			properties: {
				type?: { const?: string };
				paragraphs?: {
					items: {
						items: {
							properties: { link: { properties: { href: { pattern?: string } } } };
						};
					};
				};
			};
		};
		const schema = toJsonSchema() as ExportedJsonSchema;
		const blocks = schema.properties.sections.items.properties.blocks.items.oneOf as BlockNode[];
		const textBlock = blocks.find((block) => block.properties.type?.const === 'text');
		expect(textBlock).toBeDefined();
		expect(
			textBlock?.properties.paragraphs?.items.items.properties.link.properties.href.pattern
		).toBe('^https?://');
	});
});
