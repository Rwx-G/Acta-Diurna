import { describe, expect, expectTypeOf, it } from 'vitest';
import { validateDocument } from '../errors.ts';
import {
	listBlockSchema,
	MAX_LIST_ITEMS,
	MAX_LIST_ITEM_PARAGRAPHS,
	type ListBlock
} from './list.ts';

function validBlock(overrides: Partial<ListBlock> = {}): ListBlock {
	return {
		type: 'list',
		id: 'remediation',
		ordered: true,
		items: [
			{ term: 'Rotate the credential', description: [[{ text: 'Issue a fresh token.' }]] },
			{ term: 'Revoke the old token' },
			{ description: [[{ text: 'Confirm the change in the audit log.' }]] }
		],
		...overrides
	};
}

function documentWith(block: unknown): unknown {
	return {
		version: 1,
		title: 'Audit',
		sections: [{ id: 'overview', title: 'Overview', blocks: [block] }]
	};
}

describe('listBlockSchema - valid shapes', () => {
	it('parses a full ordered list block with type inference', () => {
		const result = listBlockSchema.safeParse(validBlock());
		expect(result.success).toBe(true);
		if (result.success) {
			expectTypeOf(result.data).toEqualTypeOf<ListBlock>();
			expect(result.data.ordered).toBe(true);
			expect(result.data.items[0].term).toBe('Rotate the credential');
		}
	});

	it('parses an unordered list block', () => {
		const result = listBlockSchema.safeParse(validBlock({ ordered: false }));
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.ordered).toBe(false);
		}
	});

	it('accepts an item with a term but no description', () => {
		const result = listBlockSchema.safeParse(validBlock({ items: [{ term: 'Standalone step' }] }));
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.items[0].description).toBeUndefined();
		}
	});

	it('accepts an item with a description but no term', () => {
		const result = listBlockSchema.safeParse(
			validBlock({ items: [{ description: [[{ text: 'No lead label.' }]] }] })
		);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.items[0].term).toBeUndefined();
		}
	});

	it('accepts a description with inline-run formatting (the text rich-text vocabulary)', () => {
		const result = listBlockSchema.safeParse(
			validBlock({
				items: [
					{
						term: 'Run the check',
						description: [
							[
								{ text: 'Execute ' },
								{ text: 'pnpm audit', code: true },
								{ text: ' before release.' }
							]
						]
					}
				]
			})
		);
		expect(result.success).toBe(true);
	});

	it('accepts optional audiences', () => {
		const result = listBlockSchema.safeParse(validBlock({ audiences: ['technical'] }));
		expect(result.success).toBe(true);
	});

	it('assembles into a valid document (no scales needed)', () => {
		expect(validateDocument(documentWith(validBlock())).ok).toBe(true);
	});

	it('accepts exactly MAX_LIST_ITEMS items', () => {
		const items = Array.from({ length: MAX_LIST_ITEMS }, (_, index) => ({ term: `Step ${index}` }));
		expect(listBlockSchema.safeParse(validBlock({ items })).success).toBe(true);
	});
});

describe('listBlockSchema - malformed shapes', () => {
	it('rejects an item with neither term nor description (the at-least-one-of rule)', () => {
		const result = listBlockSchema.safeParse(validBlock({ items: [{}] }));
		expect(result.success).toBe(false);
	});

	it('rejects a missing ordered flag', () => {
		const result = listBlockSchema.safeParse({
			type: 'list',
			id: 'steps',
			items: [{ term: 'Step' }]
		});
		expect(result.success).toBe(false);
	});

	it('rejects an empty items array', () => {
		expect(listBlockSchema.safeParse(validBlock({ items: [] })).success).toBe(false);
	});

	it('rejects an empty term', () => {
		expect(listBlockSchema.safeParse(validBlock({ items: [{ term: '' }] })).success).toBe(false);
	});

	it('rejects a term over 200 characters', () => {
		expect(
			listBlockSchema.safeParse(validBlock({ items: [{ term: 'x'.repeat(201) }] })).success
		).toBe(false);
	});

	it('rejects an empty description array', () => {
		expect(
			listBlockSchema.safeParse(validBlock({ items: [{ term: 't', description: [] }] })).success
		).toBe(false);
	});

	it('rejects more than MAX_LIST_ITEM_PARAGRAPHS description paragraphs', () => {
		const description = Array.from({ length: MAX_LIST_ITEM_PARAGRAPHS + 1 }, () => [{ text: 'p' }]);
		expect(
			listBlockSchema.safeParse(validBlock({ items: [{ term: 't', description }] })).success
		).toBe(false);
	});

	it('rejects more than MAX_LIST_ITEMS items', () => {
		const items = Array.from({ length: MAX_LIST_ITEMS + 1 }, (_, index) => ({
			term: `Step ${index}`
		}));
		expect(listBlockSchema.safeParse(validBlock({ items })).success).toBe(false);
	});

	it('names the offending item on an empty item in a document (FR2 actionable error)', () => {
		const result = validateDocument(documentWith(validBlock({ items: [{}] })));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const paths = result.errors.map((error) => error.path);
			expect(paths.some((path) => path.includes('items[0]'))).toBe(true);
		}
	});
});

describe('list block - additivity', () => {
	it('does not affect a v1 document with no list block', () => {
		const result = validateDocument({
			version: 1,
			title: 'Plain',
			sections: [
				{
					id: 'overview',
					title: 'Overview',
					blocks: [{ type: 'text', id: 't', paragraphs: [[{ text: 'x' }]] }]
				}
			]
		});
		expect(result.ok).toBe(true);
	});
});
