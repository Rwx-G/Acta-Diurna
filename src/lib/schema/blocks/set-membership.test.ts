import { describe, expect, expectTypeOf, it } from 'vitest';
import { validateDocument } from '../errors.ts';
import { setMembershipBlockSchema, type SetMembershipBlock } from './set-membership.ts';

function validBlock(overrides: Partial<SetMembershipBlock> = {}): SetMembershipBlock {
	return {
		type: 'set-membership',
		id: 'upset',
		sourceBlockId: 'coverage',
		...overrides
	};
}

describe('setMembershipBlockSchema - valid shapes', () => {
	it('parses a set-membership block with type inference', () => {
		const result = setMembershipBlockSchema.safeParse(validBlock());
		expect(result.success).toBe(true);
		if (result.success) {
			expectTypeOf(result.data).toEqualTypeOf<SetMembershipBlock>();
			expect(result.data.sourceBlockId).toBe('coverage');
		}
	});

	it('accepts an optional title', () => {
		const result = setMembershipBlockSchema.safeParse(validBlock({ title: 'Coverage' }));
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.title).toBe('Coverage');
	});

	it('accepts an optional audiences list', () => {
		const result = setMembershipBlockSchema.safeParse(validBlock({ audiences: ['technical'] }));
		expect(result.success).toBe(true);
	});
});

describe('setMembershipBlockSchema - malformed shapes', () => {
	it('rejects a missing sourceBlockId', () => {
		const { sourceBlockId, ...rest } = validBlock();
		void sourceBlockId;
		expect(setMembershipBlockSchema.safeParse(rest).success).toBe(false);
	});

	it('rejects a non-slug sourceBlockId', () => {
		expect(
			setMembershipBlockSchema.safeParse(validBlock({ sourceBlockId: 'Not A Slug' })).success
		).toBe(false);
	});

	it('rejects a title over 300 characters', () => {
		expect(setMembershipBlockSchema.safeParse(validBlock({ title: 'x'.repeat(301) })).success).toBe(
			false
		);
	});

	it('rejects an empty title', () => {
		expect(setMembershipBlockSchema.safeParse(validBlock({ title: '' })).success).toBe(false);
	});
});

describe('set-membership block - additivity', () => {
	it('does not affect a v1 document with no set-membership block', () => {
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
