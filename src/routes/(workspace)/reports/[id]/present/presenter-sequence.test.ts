import { describe, expect, it } from 'vitest';
import type { SectionView } from '$lib/render';
import { validateDocument, type DocumentV1 } from '$lib/schema';
import {
	indexAfterMeetingToggle,
	presentedSequence,
	presenterState,
	toPresenterSections,
	type PresenterSection
} from './presenter-sequence.ts';

function section(id: string, annex = false, notes?: string): PresenterSection {
	const view: SectionView = { id, title: id, annex, detail: false, invalid: false, blocks: [] };
	return { view, annex, notes };
}

// A four-section deck: the third is an annex, the rest are normal flow.
const sections: PresenterSection[] = [
	section('intro'),
	section('body'),
	section('appendix', true, 'Skip unless asked.'),
	section('closing')
];

describe('presentedSequence', () => {
	it('presents every section when meeting mode is off', () => {
		const sequence = presentedSequence(sections, false);
		expect(sequence.map((entry) => entry.section.view.id)).toEqual([
			'intro',
			'body',
			'appendix',
			'closing'
		]);
	});

	it('hides annex-marked sections when meeting mode is on', () => {
		const sequence = presentedSequence(sections, true);
		expect(sequence.map((entry) => entry.section.view.id)).toEqual(['intro', 'body', 'closing']);
		expect(sequence.some((entry) => entry.section.annex)).toBe(false);
	});

	it('keeps the original document index so deep links and keys stay stable', () => {
		const sequence = presentedSequence(sections, true);
		// `closing` is document index 3 even though it is sequence index 2 in meeting mode.
		expect(sequence[2]).toMatchObject({ documentIndex: 3 });
	});
});

describe('presenterState', () => {
	it('derives current, next and navigation flags', () => {
		const state = presenterState(sections, 0, false);
		expect(state.current?.section.view.id).toBe('intro');
		expect(state.next?.section.view.id).toBe('body');
		expect(state.hasPrevious).toBe(false);
		expect(state.hasNext).toBe(true);
	});

	it('reports no next on the last presented section', () => {
		const state = presenterState(sections, 3, false);
		expect(state.current?.section.view.id).toBe('closing');
		expect(state.next).toBeNull();
		expect(state.hasNext).toBe(false);
		expect(state.hasPrevious).toBe(true);
	});

	it('next preview skips the annex section in meeting mode', () => {
		// In meeting mode the sequence is intro, body, closing: after body the next
		// preview is closing, never the hidden appendix.
		const state = presenterState(sections, 1, true);
		expect(state.current?.section.view.id).toBe('body');
		expect(state.next?.section.view.id).toBe('closing');
	});

	it('clamps a too-large index onto the last presented section', () => {
		const state = presenterState(sections, 99, true);
		expect(state.current?.section.view.id).toBe('closing');
		expect(state.hasNext).toBe(false);
	});

	it('clamps a negative index onto the first section', () => {
		const state = presenterState(sections, -5, false);
		expect(state.current?.section.view.id).toBe('intro');
	});

	it('yields a null current for an empty deck', () => {
		const state = presenterState([], 0, false);
		expect(state.current).toBeNull();
		expect(state.next).toBeNull();
		expect(state.hasPrevious).toBe(false);
		expect(state.hasNext).toBe(false);
	});

	it('carries speaker notes through on the presented section', () => {
		const state = presenterState(sections, 2, false);
		expect(state.current?.section.notes).toBe('Skip unless asked.');
	});
});

describe('toPresenterSections', () => {
	function documentWith(): DocumentV1 {
		const result = validateDocument({
			version: 1,
			title: 'Briefed deck',
			sections: [
				{
					id: 'intro',
					title: 'Intro',
					notes: 'Welcome the room.',
					blocks: [{ type: 'text', id: 't1', paragraphs: [[{ text: 'Hi.' }]] }]
				},
				{
					id: 'method',
					title: 'Method',
					annex: true,
					blocks: [{ type: 'text', id: 't2', paragraphs: [[{ text: 'Detail.' }]] }]
				}
			]
		});
		if (!result.ok) throw new Error('fixture invalid');
		return result.document;
	}

	it('pairs each render section with its author-only notes from the document', () => {
		const { sections } = toPresenterSections(documentWith());
		expect(sections[0].view.id).toBe('intro');
		expect(sections[0].notes).toBe('Welcome the room.');
		expect(sections[1].annex).toBe(true);
		expect(sections[1].notes).toBeUndefined();
	});

	it('produces a reader view-model that still carries no notes (privacy boundary)', () => {
		const { view } = toPresenterSections(documentWith());
		// The notes ride on the presenter pairs, never on the reader-shaped view.
		expect(view.sections[0]).not.toHaveProperty('notes');
		expect(JSON.stringify(view)).not.toContain('Welcome the room.');
	});

	it('excludes detail sections from the deck and pairs notes by id (Epic 11)', () => {
		// A detail section sitting BEFORE a flow section would break positional
		// notes-pairing; the deck drops it and pairs notes by id, so each flow
		// section keeps its own notes.
		const result = validateDocument({
			version: 1,
			title: 'Drill-down deck',
			sections: [
				{
					id: 'finding-detail',
					title: 'Finding detail',
					kind: 'detail',
					notes: 'Detail-page cue (never presented).',
					blocks: [{ type: 'text', id: 'd1', paragraphs: [[{ text: 'Evidence.' }]] }]
				},
				{
					id: 'overview',
					title: 'Overview',
					notes: 'Open with the headline.',
					blocks: [{ type: 'text', id: 't1', paragraphs: [[{ text: 'Hi.' }]] }]
				}
			]
		});
		if (!result.ok) throw new Error('fixture invalid');
		const { sections } = toPresenterSections(result.document);
		expect(sections.map((s) => s.view.id)).toEqual(['overview']);
		expect(sections[0].notes).toBe('Open with the headline.');
	});
});

describe('indexAfterMeetingToggle', () => {
	it('stays on the same document section when it survives the toggle', () => {
		// On `closing` (document index 3) with meeting mode off; turning it on keeps
		// the presenter on `closing`, now at sequence index 2.
		expect(indexAfterMeetingToggle(sections, 3, true)).toBe(2);
	});

	it('falls to the nearest earlier presented section when the current is hidden', () => {
		// On `appendix` (the annex, document index 2); enabling meeting mode hides it,
		// so the presenter lands on `body` (document index 1, sequence index 1).
		expect(indexAfterMeetingToggle(sections, 2, true)).toBe(1);
	});

	it('re-finds the section when meeting mode turns off', () => {
		// `closing` is sequence index 2 in meeting mode and index 3 with it off.
		expect(indexAfterMeetingToggle(sections, 3, false)).toBe(3);
	});
});
