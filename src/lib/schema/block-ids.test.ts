import { describe, expect, it } from 'vitest';
import { validateDocument } from './errors.ts';
import { validateBlockIds } from './block-ids.ts';

function textBlock(id: string) {
	return { type: 'text', id, paragraphs: [[{ text: 'Body.' }]] };
}

function section(id: string, blocks: unknown[]) {
	return { id, title: `Section ${id}`, blocks };
}

function doc(sections: unknown[]) {
	return { version: 1 as const, title: 'Doc', sections };
}

describe('validateBlockIds seam', () => {
	it('returns no issues when every block id is distinct', () => {
		const issues = validateBlockIds({
			sections: [{ blocks: [{ id: 'a' }, { id: 'b' }] }, { blocks: [{ id: 'c' }] }]
		});
		expect(issues).toEqual([]);
	});

	it('flags a duplicate block id within one section, naming the id', () => {
		const issues = validateBlockIds({
			sections: [{ blocks: [{ id: 'kpi' }, { id: 'kpi' }] }]
		});
		expect(issues).toHaveLength(1);
		expect(issues[0]?.path).toEqual(['sections', 0, 'blocks', 1, 'id']);
		expect(issues[0]?.message).toContain('kpi');
		expect(issues[0]?.hint).toBeTruthy();
	});

	it('flags a duplicate block id ACROSS sections (uniqueness is document-wide)', () => {
		const issues = validateBlockIds({
			sections: [{ blocks: [{ id: 'shared' }] }, { blocks: [{ id: 'shared' }] }]
		});
		expect(issues).toHaveLength(1);
		expect(issues[0]?.path).toEqual(['sections', 1, 'blocks', 0, 'id']);
	});
});

describe('validateBlockIds - duplicate ids fail validation (FR2 parity)', () => {
	it('rejects a document with two blocks sharing an id, with an actionable error', () => {
		const result = validateDocument(
			doc([section('overview', [textBlock('intro'), textBlock('intro')])])
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const issue = result.errors.find((e) => e.message.includes('Duplicate block id'));
			expect(issue?.path).toBe('sections[0].blocks[1].id');
			expect(issue?.message).toContain('intro');
			expect(issue?.message).toContain('unique');
			expect(issue?.hint).toBeTruthy();
		}
	});

	it('rejects a duplicate block id that spans two sections', () => {
		const result = validateDocument(
			doc([section('one', [textBlock('body')]), section('two', [textBlock('body')])])
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const dupes = result.errors.filter((e) => e.message.includes('Duplicate block id'));
			expect(dupes.map((e) => e.path)).toEqual(['sections[1].blocks[0].id']);
		}
	});

	it('passes a document whose block ids are all distinct', () => {
		const result = validateDocument(
			doc([section('overview', [textBlock('intro'), textBlock('summary')])])
		);
		expect(result.ok).toBe(true);
	});
});
