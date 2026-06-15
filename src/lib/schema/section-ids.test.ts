import { describe, expect, it } from 'vitest';
import { validateDocument } from './errors.ts';
import { validateSectionIds } from './section-ids.ts';

function textBlock(id = 'body') {
	return { type: 'text', id, paragraphs: [[{ text: 'Body.' }]] };
}

// The default block id is derived from the section id so two DISTINCT sections get
// distinct block ids (block-id uniqueness is document-wide). A caller that repeats a
// section id intentionally also repeats the block id, but those cases assert on the
// section-id errors and filter the block-id ones out.
function section(id: string, blocks: unknown[] = [textBlock(`body-${id}`)]) {
	return { id, title: `Section ${id}`, blocks };
}

function doc(sections: unknown[]) {
	return { version: 1 as const, title: 'Doc', sections };
}

describe('validateSectionIds seam', () => {
	it('returns no issues for a document whose section ids are all distinct', () => {
		const issues = validateSectionIds({
			sections: [{ id: 'overview' }, { id: 'detail' }, { id: 'appendix' }]
		});
		expect(issues).toEqual([]);
	});

	it('flags the later occurrence of a duplicated id, naming the id', () => {
		const issues = validateSectionIds({
			sections: [{ id: 'overview' }, { id: 'overview' }]
		});
		expect(issues).toHaveLength(1);
		expect(issues[0]?.path).toEqual(['sections', 1, 'id']);
		expect(issues[0]?.message).toContain('overview');
		expect(issues[0]?.hint).toBeTruthy();
	});
});

describe('validateSectionIds - duplicate ids fail validation (FR2 parity)', () => {
	it('rejects a document with two sections sharing an id, with an actionable error', () => {
		const result = validateDocument(doc([section('overview'), section('overview')]));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const issue = result.errors.find((e) => e.message.includes('Duplicate section id'));
			expect(issue?.path).toBe('sections[1].id');
			expect(issue?.message).toContain('overview');
			expect(issue?.message).toContain('unique');
			expect(issue?.hint).toBeTruthy();
		}
	});

	it('flags every later duplicate when an id repeats three times', () => {
		const result = validateDocument(
			doc([section('overview'), section('overview'), section('overview')])
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const dupes = result.errors.filter((e) => e.message.includes('Duplicate section id'));
			expect(dupes.map((e) => e.path)).toEqual(['sections[1].id', 'sections[2].id']);
		}
	});

	it('passes a document whose section ids are all distinct', () => {
		const result = validateDocument(doc([section('overview'), section('detail')]));
		expect(result.ok).toBe(true);
	});
});

describe('validateSectionIds - interaction with a linkTo to a duplicated id', () => {
	it('reports the duplicate-id error, not a dangling-link error, when a linkTo targets the duplicated id', () => {
		// The linkTo still resolves (the id exists, twice), so the internal-link pass
		// stays silent; the duplicate-id pass names the real problem. The producer
		// gets one unambiguous fix: make the section ids distinct.
		const result = validateDocument(
			doc([
				section('overview', [
					{ type: 'text', id: 'intro', paragraphs: [[{ text: 'go', linkTo: 'detail' }]] }
				]),
				section('detail'),
				section('detail')
			])
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const dupes = result.errors.filter((e) => e.message.includes('Duplicate section id'));
			expect(dupes).toHaveLength(1);
			expect(dupes[0]?.path).toBe('sections[2].id');
			const dangling = result.errors.filter((e) => e.message.includes('Unknown internal link'));
			expect(dangling).toEqual([]);
		}
	});
});
