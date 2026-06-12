import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from './openapi';
import { toJsonSchema } from '$lib/schema';

type OpenApiDoc = {
	openapi: string;
	info: { title: string; version: string };
	security: Array<Record<string, unknown>>;
	components: {
		securitySchemes: Record<string, { type: string; scheme?: string }>;
		schemas: Record<string, unknown>;
	};
	paths: Record<string, Record<string, unknown>>;
};

const doc = buildOpenApiDocument() as OpenApiDoc;

describe('buildOpenApiDocument (D8)', () => {
	it('declares OpenAPI 3.1.0', () => {
		expect(doc.openapi).toBe('3.1.0');
	});

	it('serializes cleanly (no zod internals, round-trips)', () => {
		const serialized = JSON.stringify(doc);
		expect(serialized).not.toContain('~standard');
		expect(JSON.parse(serialized)).toEqual(doc);
	});

	it('describes every 4.1/4.2/4.3 path', () => {
		expect(Object.keys(doc.paths).sort()).toEqual(
			[
				'/reports',
				'/reports/{id}',
				'/reports/{id}/publish',
				'/reports/{id}/unpublish',
				'/whoami',
				'/data-sets',
				'/schema'
			].sort()
		);
	});

	it('covers the 4.3 data-push and schema operations', () => {
		expect(doc.paths['/data-sets'].post).toBeDefined();
		expect(doc.paths['/schema'].get).toBeDefined();
		// The schema endpoint is public: it overrides the global security with an
		// empty array (no bearer required).
		expect((doc.paths['/schema'].get as { security: unknown[] }).security).toEqual([]);
	});

	it('covers the report CRUD + publish operations', () => {
		expect(doc.paths['/reports'].get).toBeDefined();
		expect(doc.paths['/reports'].post).toBeDefined();
		expect(doc.paths['/reports/{id}'].get).toBeDefined();
		expect(doc.paths['/reports/{id}'].patch).toBeDefined();
		expect(doc.paths['/reports/{id}'].delete).toBeDefined();
		expect(doc.paths['/reports/{id}/publish'].post).toBeDefined();
		expect(doc.paths['/reports/{id}/unpublish'].post).toBeDefined();
	});

	it('advertises the PAT bearer security scheme (D10)', () => {
		const scheme = doc.components.securitySchemes.patBearer;
		expect(scheme.type).toBe('http');
		expect(scheme.scheme).toBe('bearer');
		expect(doc.security).toContainEqual({ patBearer: [] });
	});

	it('defines a Problem component matching the RFC 9457 shape with actionable errors[]', () => {
		const problem = doc.components.schemas.Problem as {
			properties: Record<string, unknown>;
			required: string[];
		};
		expect(problem.required).toEqual(['type', 'title', 'status']);
		expect(problem.properties.errors).toBeDefined();
	});

	it('embeds the generated document schema as the Document component', () => {
		const { $schema: _dialect, ...expected } = toJsonSchema();
		void _dialect;
		expect(doc.components.schemas.Document).toEqual(expected);
	});

	it('references the Document component from the report and request schemas', () => {
		const report = doc.components.schemas.Report as {
			properties: { document: { $ref: string } };
		};
		expect(report.properties.document.$ref).toBe('#/components/schemas/Document');
	});

	it('only $refs schemas that exist under components/schemas (no dangling refs)', () => {
		const defined = new Set(Object.keys(doc.components.schemas));
		const refs = new Set<string>();
		const walk = (node: unknown): void => {
			if (Array.isArray(node)) {
				node.forEach(walk);
				return;
			}
			if (typeof node !== 'object' || node === null) return;
			for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
				if (key === '$ref' && typeof value === 'string') refs.add(value);
				else walk(value);
			}
		};
		walk(doc);
		for (const ref of refs) {
			expect(ref.startsWith('#/components/schemas/')).toBe(true);
			expect(defined.has(ref.replace('#/components/schemas/', ''))).toBe(true);
		}
	});
});
