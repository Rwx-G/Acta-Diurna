import { describe, expect, expectTypeOf, it } from 'vitest';
import { validateDocument } from '../errors.ts';
import { legendBlockSchema, type LegendBlock } from './legend.ts';

function validBlock(overrides: Partial<LegendBlock> = {}): LegendBlock {
	return {
		type: 'legend',
		id: 'source-legend',
		scaleRef: 'sources',
		...overrides
	};
}

/** A document carrying a sources scale and the given legend block. */
function documentWithLegend(block: unknown, withScales = true): unknown {
	return {
		version: 1,
		title: 'Audit',
		...(withScales
			? {
					scales: [
						{
							key: 'sources',
							label: 'Sources',
							kind: 'nominal',
							entries: [
								{ key: 'siem', label: 'SIEM' },
								{ key: 'edr', label: 'EDR' }
							]
						}
					]
				}
			: {}),
		sections: [{ id: 'overview', title: 'Overview', blocks: [block] }]
	};
}

describe('legendBlockSchema - valid shapes', () => {
	it('parses a legend block with type inference', () => {
		const result = legendBlockSchema.safeParse(validBlock());
		expect(result.success).toBe(true);
		if (result.success) {
			expectTypeOf(result.data).toEqualTypeOf<LegendBlock>();
			expect(result.data.scaleRef).toBe('sources');
		}
	});

	it('accepts an optional title', () => {
		const result = legendBlockSchema.safeParse(validBlock({ title: 'Sources' }));
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.title).toBe('Sources');
	});

	it('assembles into a valid document when the scale resolves', () => {
		expect(validateDocument(documentWithLegend(validBlock())).ok).toBe(true);
	});
});

describe('legendBlockSchema - malformed shapes', () => {
	it('rejects a missing scaleRef', () => {
		const { scaleRef: _unused, ...rest } = validBlock();
		void _unused;
		expect(legendBlockSchema.safeParse(rest).success).toBe(false);
	});

	it('rejects a non-slug scaleRef', () => {
		expect(legendBlockSchema.safeParse(validBlock({ scaleRef: 'Not A Slug' })).success).toBe(false);
	});

	it('rejects a title over 200 characters', () => {
		expect(legendBlockSchema.safeParse(validBlock({ title: 'x'.repeat(201) })).success).toBe(false);
	});
});

describe('legend block - cross reference (FR2)', () => {
	it('passes when the scaleRef resolves', () => {
		expect(validateDocument(documentWithLegend(validBlock())).ok).toBe(true);
	});

	it('flags an unknown scaleRef at the block path, naming the missing scale', () => {
		const result = validateDocument(documentWithLegend(validBlock({ scaleRef: 'ghost' })));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const issue = result.errors.find((e) => e.path.endsWith('scaleRef'));
			expect(issue?.path).toBe('sections[0].blocks[0].scaleRef');
			expect(issue?.message).toContain('ghost');
			expect(issue?.hint).toContain('ghost');
		}
	});

	it('flags a dangling reference when the document declares no scales', () => {
		const result = validateDocument(documentWithLegend(validBlock(), false));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.some((e) => e.path.endsWith('scaleRef'))).toBe(true);
		}
	});
});

describe('legend block - additivity', () => {
	it('does not affect a v1 document with no legend block', () => {
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
