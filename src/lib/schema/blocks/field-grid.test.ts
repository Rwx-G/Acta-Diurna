import { describe, expect, expectTypeOf, it } from 'vitest';
import { validateDocument } from '../errors.ts';
import { fieldGridBlockSchema, MAX_FIELD_ITEMS, type FieldGridBlock } from './field-grid.ts';

function validBlock(overrides: Partial<FieldGridBlock> = {}): FieldGridBlock {
	return {
		type: 'field-grid',
		id: 'metadata',
		items: [
			{ label: 'Author', value: 'Security team' },
			{ label: 'Date', value: 'Q2 2026' }
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

describe('fieldGridBlockSchema - valid shapes', () => {
	it('parses a full field-grid block with type inference', () => {
		const result = fieldGridBlockSchema.safeParse(validBlock());
		expect(result.success).toBe(true);
		if (result.success) {
			expectTypeOf(result.data).toEqualTypeOf<FieldGridBlock>();
			expect(result.data.items[0].label).toBe('Author');
		}
	});

	it('accepts optional audiences', () => {
		const result = fieldGridBlockSchema.safeParse(validBlock({ audiences: ['summary'] }));
		expect(result.success).toBe(true);
	});

	it('assembles into a valid document (no scales needed)', () => {
		expect(validateDocument(documentWith(validBlock())).ok).toBe(true);
	});
});

describe('fieldGridBlockSchema - malformed shapes', () => {
	it('rejects an empty items array', () => {
		expect(fieldGridBlockSchema.safeParse(validBlock({ items: [] })).success).toBe(false);
	});

	it('rejects an empty label', () => {
		const result = fieldGridBlockSchema.safeParse(
			validBlock({ items: [{ label: '', value: 'x' }] })
		);
		expect(result.success).toBe(false);
	});

	it('rejects an empty value', () => {
		const result = fieldGridBlockSchema.safeParse(
			validBlock({ items: [{ label: 'x', value: '' }] })
		);
		expect(result.success).toBe(false);
	});

	it('rejects a label over 200 characters', () => {
		const result = fieldGridBlockSchema.safeParse(
			validBlock({ items: [{ label: 'x'.repeat(201), value: 'v' }] })
		);
		expect(result.success).toBe(false);
	});

	it('rejects a value over 500 characters', () => {
		const result = fieldGridBlockSchema.safeParse(
			validBlock({ items: [{ label: 'l', value: 'x'.repeat(501) }] })
		);
		expect(result.success).toBe(false);
	});

	it('rejects more than MAX_FIELD_ITEMS items', () => {
		const items = Array.from({ length: MAX_FIELD_ITEMS + 1 }, () => ({ label: 'l', value: 'v' }));
		expect(fieldGridBlockSchema.safeParse(validBlock({ items })).success).toBe(false);
	});

	it('accepts exactly MAX_FIELD_ITEMS items', () => {
		const items = Array.from({ length: MAX_FIELD_ITEMS }, () => ({ label: 'l', value: 'v' }));
		expect(fieldGridBlockSchema.safeParse(validBlock({ items })).success).toBe(true);
	});
});

describe('field-grid block - additivity', () => {
	it('does not affect a v1 document with no field-grid block', () => {
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
