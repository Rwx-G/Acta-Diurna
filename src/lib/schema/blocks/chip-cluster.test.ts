import { describe, expect, expectTypeOf, it } from 'vitest';
import { validateDocument } from '../errors.ts';
import { chipClusterBlockSchema, MAX_CHIPS, type ChipClusterBlock } from './chip-cluster.ts';

function validBlock(overrides: Partial<ChipClusterBlock> = {}): ChipClusterBlock {
	return {
		type: 'chip-cluster',
		id: 'statuses',
		scaleRef: 'status',
		entries: ['done', 'in-progress'],
		...overrides
	};
}

/** A document carrying a status scale and the given chip-cluster block. */
function documentWithCluster(block: unknown, withScales = true): unknown {
	return {
		version: 1,
		title: 'Status',
		...(withScales
			? {
					scales: [
						{
							key: 'status',
							label: 'Status',
							kind: 'nominal',
							entries: [
								{ key: 'done', label: 'Done' },
								{ key: 'in-progress', label: 'In progress' },
								{ key: 'blocked', label: 'Blocked' }
							]
						}
					]
				}
			: {}),
		sections: [{ id: 'overview', title: 'Overview', blocks: [block] }]
	};
}

describe('chipClusterBlockSchema - valid shapes', () => {
	it('parses a chip-cluster block with type inference', () => {
		const result = chipClusterBlockSchema.safeParse(validBlock());
		expect(result.success).toBe(true);
		if (result.success) {
			expectTypeOf(result.data).toEqualTypeOf<ChipClusterBlock>();
			expect(result.data.scaleRef).toBe('status');
			expect(result.data.entries).toEqual(['done', 'in-progress']);
		}
	});

	it('accepts an optional title', () => {
		const result = chipClusterBlockSchema.safeParse(validBlock({ title: 'Workstreams' }));
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.title).toBe('Workstreams');
	});

	it('assembles into a valid document when the scale and entries resolve', () => {
		expect(validateDocument(documentWithCluster(validBlock())).ok).toBe(true);
	});
});

describe('chipClusterBlockSchema - malformed shapes', () => {
	it('rejects a missing scaleRef', () => {
		const { scaleRef: _unused, ...rest } = validBlock();
		void _unused;
		expect(chipClusterBlockSchema.safeParse(rest).success).toBe(false);
	});

	it('rejects a non-slug scaleRef', () => {
		expect(chipClusterBlockSchema.safeParse(validBlock({ scaleRef: 'Not A Slug' })).success).toBe(
			false
		);
	});

	it('rejects an empty entries array', () => {
		expect(chipClusterBlockSchema.safeParse(validBlock({ entries: [] })).success).toBe(false);
	});

	it('rejects more than MAX_CHIPS entries', () => {
		const entries = Array.from({ length: MAX_CHIPS + 1 }, () => 'done');
		expect(chipClusterBlockSchema.safeParse(validBlock({ entries })).success).toBe(false);
	});

	it('rejects a non-slug entry key', () => {
		expect(chipClusterBlockSchema.safeParse(validBlock({ entries: ['Not A Slug'] })).success).toBe(
			false
		);
	});

	it('rejects a title over 200 characters', () => {
		expect(chipClusterBlockSchema.safeParse(validBlock({ title: 'x'.repeat(201) })).success).toBe(
			false
		);
	});
});

describe('chip-cluster block - cross reference (FR2)', () => {
	it('passes when the scaleRef and every entry key resolve', () => {
		expect(validateDocument(documentWithCluster(validBlock())).ok).toBe(true);
	});

	it('flags an unknown scaleRef at the block path, naming the missing scale', () => {
		const result = validateDocument(documentWithCluster(validBlock({ scaleRef: 'ghost' })));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const issue = result.errors.find((e) => e.path.endsWith('scaleRef'));
			expect(issue?.path).toBe('sections[0].blocks[0].scaleRef');
			expect(issue?.message).toContain('ghost');
			expect(issue?.hint).toContain('ghost');
		}
	});

	it('flags an unknown entry key at the entry path, naming the missing chip', () => {
		const result = validateDocument(
			documentWithCluster(validBlock({ entries: ['done', 'ghost'] }))
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const issue = result.errors.find((e) => e.path.endsWith('entries[1]'));
			expect(issue?.path).toBe('sections[0].blocks[0].entries[1]');
			expect(issue?.message).toContain('ghost');
		}
	});

	it('flags a dangling reference when the document declares no scales', () => {
		const result = validateDocument(documentWithCluster(validBlock(), false));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.some((e) => e.path.endsWith('scaleRef'))).toBe(true);
		}
	});
});

describe('chip-cluster block - additivity', () => {
	it('does not affect a v1 document with no chip-cluster block', () => {
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
