import { describe, expect, it } from 'vitest';
import { getBrick } from '$lib/bricks';
import { sectionSchema, validateDocument } from '$lib/schema';
import {
	appendBrick,
	groupErrorsByLocation,
	moveItem,
	newSkeletonDraft,
	removeSection
} from './compose-state.ts';

const cover = getBrick('cover')!;
const dataTable = getBrick('dataTable')!;
const comparisonMatrix = getBrick('comparisonMatrix')!;
const legend = getBrick('legend')!;

describe('composer state', () => {
	it('opens with a starter Cover section', () => {
		const draft = newSkeletonDraft(cover);
		expect(draft.sections).toHaveLength(1);
		expect(draft.sections[0].title).toBe('Cover');
		expect(validateDocument(draft).ok).toBe(true);
	});

	it('appendBrick adds a schema-valid section to the end', () => {
		const draft = newSkeletonDraft(cover);
		appendBrick(draft, dataTable);
		expect(draft.sections).toHaveLength(2);
		expect(sectionSchema.safeParse(draft.sections[1]).success).toBe(true);
		expect(validateDocument(draft).ok).toBe(true);
	});

	it('appendBrick seeds the comparison-matrix companion scales so the draft validates', () => {
		const draft = newSkeletonDraft(cover);
		appendBrick(draft, comparisonMatrix);
		expect(draft.scales?.map((scale) => scale.key)).toEqual(['severity', 'sources']);
		expect(validateDocument(draft).ok).toBe(true);
	});

	it('appendBrick does not duplicate a scale key when the matrix brick is added twice', () => {
		const draft = newSkeletonDraft(cover);
		appendBrick(draft, comparisonMatrix);
		appendBrick(draft, comparisonMatrix);
		expect(draft.scales).toHaveLength(2);
		expect(validateDocument(draft).ok).toBe(true);
	});

	it('appendBrick shares one sources scale across the matrix and legend bricks', () => {
		const draft = newSkeletonDraft(cover);
		appendBrick(draft, comparisonMatrix);
		appendBrick(draft, legend);
		// The legend reuses the matrix's `sources` scale, so its companion scale
		// merges by key rather than adding a second near-duplicate.
		expect(draft.scales?.map((scale) => scale.key)).toEqual(['severity', 'sources']);
		expect(draft.scales?.filter((scale) => scale.key === 'sources')).toHaveLength(1);
		expect(validateDocument(draft).ok).toBe(true);
	});

	it('moveItem reorders sections and is a no-op out of bounds', () => {
		const draft = newSkeletonDraft(cover);
		appendBrick(draft, dataTable);
		const firstId = draft.sections[0].id;
		moveItem(draft.sections, 0, 1);
		expect(draft.sections[1].id).toBe(firstId);
		moveItem(draft.sections, 1, 1);
		expect(draft.sections[1].id).toBe(firstId);
	});

	it('removeSection drops the section at the index and is a no-op out of bounds', () => {
		const draft = newSkeletonDraft(cover);
		appendBrick(draft, dataTable);
		removeSection(draft.sections, 0);
		expect(draft.sections).toHaveLength(1);
		expect(draft.sections[0].title).toBe('Data table');
		removeSection(draft.sections, 5);
		expect(draft.sections).toHaveLength(1);
	});

	it('renaming a section keeps the document valid', () => {
		const draft = newSkeletonDraft(cover);
		draft.sections[0].title = 'Overview';
		expect(validateDocument(draft).ok).toBe(true);
	});

	it('an empty section (no blocks) groups its error at the section element', () => {
		const draft = newSkeletonDraft(cover);
		draft.sections[0].blocks = [];
		const result = validateDocument(draft);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		const grouped = groupErrorsByLocation(result.errors, draft);
		const sectionKey = `section:${draft.sections[0].id}`;
		expect(grouped[sectionKey]).toBeDefined();
		expect(grouped[sectionKey][0].message).toContain('at least one block');
	});

	it('an empty section title groups its error at the section element', () => {
		const draft = newSkeletonDraft(cover);
		draft.sections[0].title = '';
		const result = validateDocument(draft);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		const grouped = groupErrorsByLocation(result.errors, draft);
		expect(grouped[`section:${draft.sections[0].id}`]).toBeDefined();
	});
});
