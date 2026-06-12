import { describe, expect, expectTypeOf, it } from 'vitest';
import { validateDocument } from '../errors.ts';
import {
	cardGridBlockSchema,
	MAX_CARD_COLUMNS,
	MAX_CARD_ITEMS,
	type CardGridBlock
} from './card-grid.ts';

function validBlock(overrides: Partial<CardGridBlock> = {}): CardGridBlock {
	return {
		type: 'card-grid',
		id: 'highlights',
		columns: 3,
		items: [
			{ icon: 'shield', title: 'Secure by default', description: 'Strict CSP, no CDN.' },
			{ icon: 'bolt', title: 'Fast', description: 'Server-rendered, zero hydration.' },
			{ title: 'Self-hosted', description: 'Clone, configure, compose up.' }
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

describe('cardGridBlockSchema - valid shapes', () => {
	it('parses a full card-grid block with type inference', () => {
		const result = cardGridBlockSchema.safeParse(validBlock());
		expect(result.success).toBe(true);
		if (result.success) {
			expectTypeOf(result.data).toEqualTypeOf<CardGridBlock>();
			expect(result.data.items[0].title).toBe('Secure by default');
			expect(result.data.columns).toBe(3);
		}
	});

	it('accepts a card with no icon (the icon is optional)', () => {
		const result = cardGridBlockSchema.safeParse(
			validBlock({ items: [{ title: 'Plain', description: 'No glyph.' }] })
		);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.items[0].icon).toBeUndefined();
		}
	});

	it('accepts optional audiences', () => {
		const result = cardGridBlockSchema.safeParse(validBlock({ audiences: ['summary'] }));
		expect(result.success).toBe(true);
	});

	it('accepts every column count up to MAX_CARD_COLUMNS', () => {
		for (let columns = 1; columns <= MAX_CARD_COLUMNS; columns++) {
			expect(cardGridBlockSchema.safeParse(validBlock({ columns })).success).toBe(true);
		}
	});

	it('assembles into a valid document (no scales needed)', () => {
		expect(validateDocument(documentWith(validBlock())).ok).toBe(true);
	});
});

describe('cardGridBlockSchema - malformed shapes', () => {
	it('rejects an unknown icon name (the 7.6 enum)', () => {
		const result = cardGridBlockSchema.safeParse(
			validBlock({
				items: [
					{
						icon: 'rocket' as unknown as NonNullable<CardGridBlock['items'][number]['icon']>,
						title: 't',
						description: 'd'
					}
				]
			})
		);
		expect(result.success).toBe(false);
	});

	it('rejects a column count below 1', () => {
		expect(cardGridBlockSchema.safeParse(validBlock({ columns: 0 })).success).toBe(false);
	});

	it('rejects a column count above MAX_CARD_COLUMNS', () => {
		expect(
			cardGridBlockSchema.safeParse(validBlock({ columns: MAX_CARD_COLUMNS + 1 })).success
		).toBe(false);
	});

	it('rejects a non-integer column count', () => {
		expect(cardGridBlockSchema.safeParse(validBlock({ columns: 2.5 })).success).toBe(false);
	});

	it('rejects an empty items array', () => {
		expect(cardGridBlockSchema.safeParse(validBlock({ items: [] })).success).toBe(false);
	});

	it('rejects an empty title', () => {
		const result = cardGridBlockSchema.safeParse(
			validBlock({ items: [{ title: '', description: 'd' }] })
		);
		expect(result.success).toBe(false);
	});

	it('rejects an empty description', () => {
		const result = cardGridBlockSchema.safeParse(
			validBlock({ items: [{ title: 't', description: '' }] })
		);
		expect(result.success).toBe(false);
	});

	it('rejects a title over 200 characters', () => {
		const result = cardGridBlockSchema.safeParse(
			validBlock({ items: [{ title: 'x'.repeat(201), description: 'd' }] })
		);
		expect(result.success).toBe(false);
	});

	it('rejects a description over 500 characters', () => {
		const result = cardGridBlockSchema.safeParse(
			validBlock({ items: [{ title: 't', description: 'x'.repeat(501) }] })
		);
		expect(result.success).toBe(false);
	});

	it('rejects more than MAX_CARD_ITEMS items', () => {
		const items = Array.from({ length: MAX_CARD_ITEMS + 1 }, () => ({
			title: 't',
			description: 'd'
		}));
		expect(cardGridBlockSchema.safeParse(validBlock({ items })).success).toBe(false);
	});

	it('accepts exactly MAX_CARD_ITEMS items', () => {
		const items = Array.from({ length: MAX_CARD_ITEMS }, () => ({ title: 't', description: 'd' }));
		expect(cardGridBlockSchema.safeParse(validBlock({ items })).success).toBe(true);
	});

	it('names the offending field on an unknown icon in a document (FR2 actionable error)', () => {
		const result = validateDocument(
			documentWith(
				validBlock({
					items: [
						{
							icon: 'spaceship' as unknown as NonNullable<CardGridBlock['items'][number]['icon']>,
							title: 't',
							description: 'd'
						}
					]
				})
			)
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const paths = result.errors.map((error) => error.path);
			expect(paths.some((path) => path.endsWith('icon'))).toBe(true);
		}
	});
});

describe('card-grid block - additivity', () => {
	it('does not affect a v1 document with no card-grid block', () => {
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
