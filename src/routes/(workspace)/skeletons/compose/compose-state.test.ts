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

describe('composer state', () => {
	it('opens with a starter Cover section', () => {
		const draft = newSkeletonDraft(cover);
		expect(draft.sections).toHaveLength(1);
		expect(draft.sections[0].title).toBe('Cover');
		expect(validateDocument(draft).ok).toBe(true);
	});

	it('appendBrick adds a schema-valid section to the end', () => {
		const draft = newSkeletonDraft(cover);
		appendBrick(draft.sections, dataTable);
		expect(draft.sections).toHaveLength(2);
		expect(sectionSchema.safeParse(draft.sections[1]).success).toBe(true);
		expect(validateDocument(draft).ok).toBe(true);
	});

	it('moveItem reorders sections and is a no-op out of bounds', () => {
		const draft = newSkeletonDraft(cover);
		appendBrick(draft.sections, dataTable);
		const firstId = draft.sections[0].id;
		moveItem(draft.sections, 0, 1);
		expect(draft.sections[1].id).toBe(firstId);
		moveItem(draft.sections, 1, 1);
		expect(draft.sections[1].id).toBe(firstId);
	});

	it('removeSection drops the section at the index and is a no-op out of bounds', () => {
		const draft = newSkeletonDraft(cover);
		appendBrick(draft.sections, dataTable);
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
