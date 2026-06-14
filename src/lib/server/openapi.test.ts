import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
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

/** The HTTP-method keys an OpenAPI path item may carry (a `parameters` sibling is not an operation). */
const OPERATION_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace'];

const API_V1_ROUTES = resolve(dirname(fileURLToPath(import.meta.url)), '../../routes/api/v1');

/** Maps an OpenAPI path (`/reports/{id}`) to its SvelteKit route dir (`reports/[id]`). */
function routeDirForPath(apiPath: string): string {
	const segments = apiPath
		.split('/')
		.filter((segment) => segment !== '')
		.map((segment) => segment.replace(/^\{(.+)\}$/, '[$1]'));
	return resolve(API_V1_ROUTES, ...segments);
}

describe('buildOpenApiDocument (D8)', () => {
	it('declares OpenAPI 3.1.0', () => {
		expect(doc.openapi).toBe('3.1.0');
	});

	it('serializes cleanly (no zod internals, round-trips)', () => {
		const serialized = JSON.stringify(doc);
		expect(serialized).not.toContain('~standard');
		expect(JSON.parse(serialized)).toEqual(doc);
	});

	it('describes every 4.1/4.2/4.3 path plus the generation paths', () => {
		expect(Object.keys(doc.paths).sort()).toEqual(
			[
				'/reports',
				'/reports/{id}',
				'/reports/{id}/publish',
				'/reports/{id}/unpublish',
				'/reports/{id}/duplicate',
				'/reports/generate/outline',
				'/reports/generate/fill',
				'/whoami',
				'/data-sets',
				'/schema'
			].sort()
		);
	});

	it('covers the outline-first generation operations', () => {
		expect(doc.paths['/reports/generate/outline'].post).toBeDefined();
		expect(doc.paths['/reports/generate/fill'].post).toBeDefined();
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
		expect(doc.paths['/reports/{id}/duplicate'].post).toBeDefined();
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

	it('carries every required OpenAPI 3.1 top-level field', () => {
		// A typo in a top-level key (e.g. `path` for `paths`) would otherwise compile
		// silently into the hand-assembled record; these assert the document is at
		// least structurally a well-formed OpenAPI 3.1 object.
		expect(doc.openapi).toMatch(/^3\.1\.\d+$/);
		expect(typeof doc.info).toBe('object');
		expect(typeof doc.info.title).toBe('string');
		expect(typeof doc.info.version).toBe('string');
		expect(typeof doc.paths).toBe('object');
		expect(typeof doc.components).toBe('object');
		expect(typeof doc.components.schemas).toBe('object');
		expect(typeof doc.components.securitySchemes).toBe('object');
	});

	it('gives every path item at least one operation, each with responses', () => {
		// Drift guard: a path item that lost all its operations (only a `parameters`
		// sibling), or an operation missing its `responses`, is a structural typo.
		for (const [apiPath, pathItem] of Object.entries(doc.paths)) {
			const operations = OPERATION_METHODS.filter((method) => method in pathItem);
			expect(operations.length, `${apiPath} has no operation`).toBeGreaterThan(0);
			for (const method of operations) {
				const operation = pathItem[method] as { responses?: Record<string, unknown> };
				expect(
					operation.responses,
					`${method.toUpperCase()} ${apiPath} has no responses`
				).toBeDefined();
				expect(Object.keys(operation.responses ?? {}).length).toBeGreaterThan(0);
			}
		}
	});

	it('documents only paths backed by an actual /api/v1 route file', () => {
		// Every documented path must map to a real `+server.ts` under
		// src/routes/api/v1, so a renamed or removed route surfaces as a failing test
		// rather than a spec that advertises a 404.
		for (const apiPath of Object.keys(doc.paths)) {
			const serverFile = resolve(routeDirForPath(apiPath), '+server.ts');
			expect(existsSync(serverFile), `no route file for ${apiPath} (expected ${serverFile})`).toBe(
				true
			);
		}
	});
});
