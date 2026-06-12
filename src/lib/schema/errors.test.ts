import { describe, expect, it } from 'vitest';
import {
	toProblemDetails,
	toValidationErrors,
	validateDocument,
	validateStoredDocument,
	type ValidationErrorDetail
} from './errors.ts';
import { documentSchemaV1 } from './versions/v1.ts';
import {
	syntheticV0Document,
	syntheticV0Migration
} from './versions/__fixtures__/synthetic-v0.fixture.ts';

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
		expect(errors[0].hint).toBe(
			'Describe the image for screen readers; alt text is required on every image block.'
		);
	});

	it('lists the valid block types for an unknown block type', () => {
		const errors = expectInvalid(documentWithBlocks([{ type: 'video', id: 'clip' }]));
		expect(errors).toHaveLength(1);
		expect(errors[0].path).toBe('sections[0].blocks[0].type');
		expect(errors[0].hint).toBe(
			'Valid block types: text, table, chart, kpi, image, comparison-matrix, field-grid, legend, set-membership, chip-cluster, callout, code, card-grid.'
		);
	});

	it('reports the supported versions for a wrong version', () => {
		const errors = expectInvalid({
			version: 2,
			title: 'Future',
			sections: [
				{
					id: 'overview',
					title: 'Overview',
					blocks: [{ type: 'text', id: 'intro', paragraphs: [[{ text: 'Intro.' }]] }]
				}
			]
		});
		expect(errors).toHaveLength(1);
		expect(errors[0].path).toBe('version');
		expect(errors[0].message).toBe('Unsupported document schema version.');
		expect(errors[0].hint).toBe('Supported document schema versions: 1.');
	});

	it('reports an actionable error when the version is missing', () => {
		const errors = expectInvalid({
			title: 'No version',
			sections: [
				{
					id: 'overview',
					title: 'Overview',
					blocks: [{ type: 'text', id: 'intro', paragraphs: [[{ text: 'Intro.' }]] }]
				}
			]
		});
		expect(errors).toHaveLength(1);
		expect(errors[0].path).toBe('version');
		expect(errors[0].message).toBe('Missing document schema version.');
		expect(errors[0].hint).toBe('Supported document schema versions: 1.');
	});

	it('routes a version 1 document through the registry dispatch', () => {
		const result = validateDocument({
			version: 1,
			title: 'Routed',
			sections: [
				{
					id: 'overview',
					title: 'Overview',
					blocks: [{ type: 'text', id: 'intro', paragraphs: [[{ text: 'Intro.' }]] }]
				}
			]
		});
		expect(result.ok).toBe(true);
	});

	it('reports the expected type for a wrong field type', () => {
		const errors = expectInvalid({
			version: 1,
			title: 42,
			sections: [
				{
					id: 'overview',
					title: 'Overview',
					blocks: [{ type: 'text', id: 'intro', paragraphs: [[{ text: 'Intro.' }]] }]
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
		expect(errors[0].hint).toBe(
			'Add inline rows for static content, or a binding declaring the expected fields.'
		);
	});

	it('rejects an invalid section id slug', () => {
		const errors = expectInvalid({
			version: 1,
			title: 'Slugs',
			sections: [
				{
					id: 'Bad Slug',
					title: 'Bad',
					blocks: [{ type: 'text', id: 'intro', paragraphs: [[{ text: 'Intro.' }]] }]
				}
			]
		});
		expect(errors).toHaveLength(1);
		expect(errors[0].path).toBe('sections[0].id');
		expect(errors[0].message).toBe('Must be a slug: lowercase letters, digits and single hyphens.');
		expect(errors[0].hint).toBe(
			'Use lowercase letters, digits and single hyphens, e.g. executive-summary.'
		);
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
					blocks: [{ type: 'text', id: 'intro', paragraphs: [[{ text: 'Intro.' }]] }]
				}
			]
		});
		expect(errors).toHaveLength(1);
		expect(errors[0].path).toBe('sections[0].audiences[0]');
		expect(errors[0].hint).toBe('Allowed values: summary, full, technical.');
	});

	it('rejects a non-UUID asset reference with format guidance', () => {
		const errors = expectInvalid(
			documentWithBlocks([
				{ type: 'image', id: 'diagram', assetId: 'https://example.com/x.png', alt: 'A diagram' }
			])
		);
		expect(errors).toHaveLength(1);
		expect(errors[0].path).toBe('sections[0].blocks[0].assetId');
		// invalid_format is code-specific, so it outranks the assetId field hint
		expect(errors[0].hint).toBe('Use a UUID, e.g. 0197b3a0-5c6e-7c2a-9f4d-2b8e6a1d3c5f.');
	});

	it('keeps the field hint for a missing asset reference', () => {
		const errors = expectInvalid(
			documentWithBlocks([{ type: 'image', id: 'diagram', alt: 'A diagram' }])
		);
		expect(errors).toHaveLength(1);
		expect(errors[0].path).toBe('sections[0].blocks[0].assetId');
		expect(errors[0].hint).toBe(
			'Reference an uploaded asset by its UUID; remote image URLs are not supported.'
		);
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

describe('validateDocument - size bounds (DoS protection)', () => {
	it('caps the number of sections at 100', () => {
		const errors = expectInvalid({
			version: 1,
			title: 'Too many sections',
			sections: Array.from({ length: 101 }, (_, index) => ({
				id: `section-${index}`,
				title: 'Section',
				blocks: [{ type: 'text', id: 'intro', paragraphs: [[{ text: 'Intro.' }]] }]
			}))
		});
		expect(errors).toHaveLength(1);
		expect(errors[0].path).toBe('sections');
		expect(errors[0].message).toBe('Too many sections: 100 maximum.');
	});

	it('caps the runs per paragraph at 200', () => {
		const errors = expectInvalid(
			documentWithBlocks([
				{
					type: 'text',
					id: 'narrative',
					paragraphs: [Array.from({ length: 201 }, () => ({ text: 'run' }))]
				}
			])
		);
		expect(errors).toHaveLength(1);
		expect(errors[0].path).toBe('sections[0].blocks[0].paragraphs[0]');
		expect(errors[0].message).toBe('Too many runs in a paragraph: 200 maximum.');
	});

	it('caps the table rows at 10000', () => {
		const errors = expectInvalid(
			documentWithBlocks([
				{
					type: 'table',
					id: 'big-table',
					columns: [{ key: 'n', label: 'N' }],
					rows: Array.from({ length: 10001 }, (_, index) => ({ n: index }))
				}
			])
		);
		expect(errors).toHaveLength(1);
		expect(errors[0].path).toBe('sections[0].blocks[0].rows');
		expect(errors[0].message).toBe('Too many table rows: 10000 maximum.');
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

describe('validateStoredDocument - version-aware rendering (FR7)', () => {
	it('validates a current-version document like the standard path', () => {
		const result = validateStoredDocument({
			version: 1,
			title: 'Current',
			sections: [
				{
					id: 'overview',
					title: 'Overview',
					blocks: [{ type: 'text', id: 'intro', paragraphs: [[{ text: 'Hi.' }]] }]
				}
			]
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.document.title).toBe('Current');
	});

	it('renders a synthetic v0 document by migrating it to v1 first (N-1 mechanism)', () => {
		// Exercises the real migration walk: v0 (with `name`) -> v1 (with `title`).
		const result = validateStoredDocument(syntheticV0Document, [syntheticV0Migration]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.document.version).toBe(1);
			expect(result.document.title).toBe('Legacy Quarterly Report');
			expect(result.document.sections[0].blocks[0].type).toBe('text');
		}
	});

	it('reports an unsupported version with the supported range as the hint', () => {
		// No migration path: the synthetic v0 has no production migration registered.
		const result = validateStoredDocument(syntheticV0Document);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0].path).toBe('version');
			expect(result.errors[0].hint).toBe('Supported document schema versions: 1.');
		}
	});

	it('still reports a root-level type error for a non-object input', () => {
		const result = validateStoredDocument('not a document');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors[0].path).toBe('document');
	});
});
