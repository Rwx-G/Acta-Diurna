import { describe, expect, it } from 'vitest';
import {
	toProblemDetails,
	toValidationErrors,
	validateDocument,
	type ValidationErrorDetail
} from './errors.ts';
import { documentSchemaV1 } from './versions/v1.ts';

function documentWithBlocks(blocks: unknown[]): unknown {
	return {
		version: 1,
		title: 'Corpus',
		sections: [{ id: 'section-one', title: 'Section One', blocks }]
	};
}

function expectInvalid(input: unknown): ValidationErrorDetail[] {
	const result = validateDocument(input);
	expect(result.ok).toBe(false);
	return result.ok ? [] : result.errors;
}

describe('validateDocument - invalid corpus', () => {
	it('names the exact path and hints for a missing image alt', () => {
		const errors = expectInvalid(
			documentWithBlocks([
				{ type: 'image', id: 'diagram', assetId: '0197b3a0-5c6e-7c2a-9f4d-2b8e6a1d3c5f' }
			])
		);
		expect(errors).toHaveLength(1);
		expect(errors[0].path).toBe('sections[0].blocks[0].alt');
		expect(errors[0].message).toBe('Missing required field: expected string.');
		expect(errors[0].hint).toContain('alt text is required');
	});

	it('lists the valid block types for an unknown block type', () => {
		const errors = expectInvalid(documentWithBlocks([{ type: 'video', id: 'clip' }]));
		expect(errors).toHaveLength(1);
		expect(errors[0].path).toBe('sections[0].blocks[0].type');
		expect(errors[0].hint).toBe('Valid block types: text, table, chart, kpi, image.');
	});

	it('reports the supported versions for a wrong version', () => {
		const errors = expectInvalid({
			version: 2,
			title: 'Future',
			sections: [
				{
					id: 'overview',
					title: 'Overview',
					blocks: [{ type: 'text', id: 'intro', paragraphs: [] }]
				}
			]
		});
		expect(errors).toHaveLength(1);
		expect(errors[0].path).toBe('version');
		expect(errors[0].message).toBe('Unsupported document schema version.');
		expect(errors[0].hint).toBe('Supported document schema versions: 1.');
	});

	it('reports the expected type for a wrong field type', () => {
		const errors = expectInvalid({
			version: 1,
			title: 42,
			sections: [
				{
					id: 'overview',
					title: 'Overview',
					blocks: [{ type: 'text', id: 'intro', paragraphs: [] }]
				}
			]
		});
		expect(errors).toHaveLength(1);
		expect(errors[0].path).toBe('title');
		expect(errors[0].hint).toBe('Provide a value of type string.');
	});

	it('rejects a document without sections', () => {
		const errors = expectInvalid({ version: 1, title: 'Empty', sections: [] });
		expect(errors).toHaveLength(1);
		expect(errors[0].path).toBe('sections');
		expect(errors[0].hint).toBe('A document needs at least one section.');
	});

	it('rejects a section without blocks', () => {
		const errors = expectInvalid(documentWithBlocks([]));
		expect(errors).toHaveLength(1);
		expect(errors[0].path).toBe('sections[0].blocks');
		expect(errors[0].hint).toBe('A section needs at least one block.');
	});

	it('requires static data or a binding on data-bound blocks', () => {
		const errors = expectInvalid(
			documentWithBlocks([
				{ type: 'table', id: 'orphan-table', columns: [{ key: 'name', label: 'Name' }] }
			])
		);
		expect(errors).toHaveLength(1);
		expect(errors[0].path).toBe('sections[0].blocks[0].rows');
		expect(errors[0].message).toBe('Provide static rows or a data binding.');
		expect(errors[0].hint).toContain('binding declaring the expected fields');
	});

	it('rejects an invalid section id slug', () => {
		const errors = expectInvalid({
			version: 1,
			title: 'Slugs',
			sections: [
				{
					id: 'Bad Slug',
					title: 'Bad',
					blocks: [{ type: 'text', id: 'intro', paragraphs: [] }]
				}
			]
		});
		expect(errors).toHaveLength(1);
		expect(errors[0].path).toBe('sections[0].id');
		expect(errors[0].message).toBe('Must be a slug: lowercase letters, digits and single hyphens.');
		expect(errors[0].hint).toContain('lowercase letters, digits and single hyphens');
	});

	it('rejects non-http(s) link URLs in narrative runs', () => {
		const errors = expectInvalid(
			documentWithBlocks([
				{
					type: 'text',
					id: 'narrative',
					paragraphs: [[{ text: 'click', link: { href: 'javascript:alert(1)' } }]]
				}
			])
		);
		expect(errors).toHaveLength(1);
		expect(errors[0].path).toBe('sections[0].blocks[0].paragraphs[0][0].link.href');
		expect(errors[0].message).toBe('Links must use an http(s) URL.');
		expect(errors[0].hint).toBe('Use an absolute http(s) URL.');
	});

	it('lists the allowed audience values for an unknown audience', () => {
		const errors = expectInvalid({
			version: 1,
			title: 'Audiences',
			sections: [
				{
					id: 'overview',
					title: 'Overview',
					audiences: ['vip'],
					blocks: [{ type: 'text', id: 'intro', paragraphs: [] }]
				}
			]
		});
		expect(errors).toHaveLength(1);
		expect(errors[0].path).toBe('sections[0].audiences[0]');
		expect(errors[0].hint).toBe('Allowed values: summary, full, technical.');
	});

	it('rejects a non-UUID asset reference', () => {
		const errors = expectInvalid(
			documentWithBlocks([
				{ type: 'image', id: 'diagram', assetId: 'https://example.com/x.png', alt: 'A diagram' }
			])
		);
		expect(errors).toHaveLength(1);
		expect(errors[0].path).toBe('sections[0].blocks[0].assetId');
		expect(errors[0].hint).toContain('remote image URLs are not supported');
	});

	it('reports the document root for non-object input', () => {
		const errors = expectInvalid('not a document');
		expect(errors).toHaveLength(1);
		expect(errors[0].path).toBe('document');
		expect(errors[0].hint).toBe('Provide a value of type object.');
	});

	it('aggregates every error in one pass', () => {
		const errors = expectInvalid({
			version: 1,
			title: '',
			sections: [
				{
					id: 'overview',
					title: 'Overview',
					blocks: [
						{ type: 'image', id: 'diagram', assetId: '0197b3a0-5c6e-7c2a-9f4d-2b8e6a1d3c5f' },
						{ type: 'unknown-thing', id: 'mystery' }
					]
				}
			]
		});
		const paths = errors.map((error) => error.path);
		expect(paths).toContain('title');
		expect(paths).toContain('sections[0].blocks[0].alt');
		expect(paths).toContain('sections[0].blocks[1].type');
	});
});

describe('toValidationErrors', () => {
	it('flattens a raw ZodError into path/message entries', () => {
		const parsed = documentSchemaV1.safeParse({ version: 1, title: 'Raw', sections: [] });
		expect(parsed.success).toBe(false);
		if (!parsed.success) {
			const errors = toValidationErrors(parsed.error);
			expect(errors).toEqual([
				{
					path: 'sections',
					message: 'A document must contain at least one section.',
					hint: 'A document needs at least one section.'
				}
			]);
		}
	});
});

describe('toProblemDetails', () => {
	it('shapes errors as an RFC 9457 problem-details body', () => {
		const errors = expectInvalid({ version: 1, title: '', sections: [] });
		const problem = toProblemDetails(errors);
		expect(problem.type).toBe('/problems/document-validation');
		expect(problem.title).toBe('Document validation failed');
		expect(problem.status).toBe(422);
		expect(problem.detail).toBe('2 validation errors found in the document.');
		expect(problem.errors).toEqual(errors);
	});

	it('uses singular wording for a single error', () => {
		const errors = expectInvalid({ version: 1, title: 'One', sections: [] });
		expect(toProblemDetails(errors).detail).toBe('1 validation error found in the document.');
	});
});
