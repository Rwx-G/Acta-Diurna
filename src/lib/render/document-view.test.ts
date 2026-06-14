import { describe, expect, it } from 'vitest';
import { toPreviewView, toReportView } from './document-view.ts';
import { fullDocument } from '$lib/schema/examples/full';
import { validateDocument, type DocumentV1 } from '$lib/schema';

function validFull(): DocumentV1 {
	const result = validateDocument(fullDocument);
	if (!result.ok) throw new Error('fixture should be valid');
	return result.document;
}

describe('toReportView', () => {
	it('maps a validated document to sections and a TOC', () => {
		const view = toReportView(validFull());
		expect(view.title).toBe('Quarterly Security Report');
		expect(view.theme).toBe('aurora');
		expect(view.sections).toHaveLength(3);
		expect(view.toc.map((t) => t.id)).toEqual([
			'executive-summary',
			'incident-analysis',
			'methodology'
		]);
		expect(view.sections.every((s) => s.blocks.every((b) => b.block !== null))).toBe(true);
	});

	it('flags the annex section', () => {
		const view = toReportView(validFull());
		const annex = view.toc.find((t) => t.id === 'methodology');
		expect(annex?.annex).toBe(true);
	});

	it('builds stable per-block anchors (section--block)', () => {
		const view = toReportView(validFull());
		const first = view.sections[0].blocks[0];
		expect(first.anchorId).toBe('executive-summary--headline-indicators');
	});

	it('threads section and block audience tags onto the view (Story 6.1)', () => {
		const view = toReportView(validFull());
		// The fixture's first section is audience-tagged; the renderer reads the
		// tags through this view to drive the level switcher and visibility CSS.
		expect(view.sections[0].audiences).toEqual(['summary', 'full']);
		expect(view.sections[0].blocks[0].audiences).toEqual(['summary']);
	});

	it('flags a tagged document as carrying audiences', () => {
		expect(toReportView(validFull()).hasAudiences).toBe(true);
	});

	it('reports no audiences when the document carries no tags', () => {
		const doc = validFull();
		const stripped: DocumentV1 = {
			...doc,
			sections: doc.sections.map((section) => ({
				...section,
				audiences: undefined,
				blocks: section.blocks.map((block) => ({ ...block, audiences: undefined }))
			}))
		};
		expect(toReportView(stripped).hasAudiences).toBe(false);
	});
});

describe('toPreviewView (transiently-invalid tolerance)', () => {
	it('renders a fully valid snapshot with every section present and none flagged', () => {
		const view = toPreviewView(fullDocument);
		expect(view.sections).toHaveLength(3);
		expect(view.sections.every((s) => !s.invalid)).toBe(true);
		// A valid snapshot renders the same shape the reader path produces, so a
		// preview of a clean document carries every block and a matching TOC.
		expect(view.sections.every((s) => s.blocks.every((b) => b.block !== null))).toBe(true);
		expect(view.toc.map((t) => t.id)).toEqual([
			'executive-summary',
			'incident-analysis',
			'methodology'
		]);
	});

	it('renders a fully valid snapshot identically to the reader path', () => {
		// Behavior parity: dropping the whole-document fast path must not change what
		// a valid snapshot produces - it equals the reader's toReportView output.
		const result = validateDocument(fullDocument);
		if (!result.ok) throw new Error('fixture should be valid');
		expect(toPreviewView(fullDocument)).toEqual(toReportView(result.document));
	});

	it('threads audience tags and the hasAudiences flag through the preview', () => {
		const snapshot = {
			version: 1,
			title: 'Tagged draft',
			sections: [
				{
					id: 'sec-1',
					title: 'Section one',
					audiences: ['summary', 'full'],
					blocks: [
						{
							type: 'text',
							id: 'deep',
							audiences: ['technical'],
							paragraphs: [[{ text: 'Technical detail.' }]]
						}
					]
				}
			]
		};
		const view = toPreviewView(snapshot);
		expect(view.hasAudiences).toBe(true);
		expect(view.sections[0].audiences).toEqual(['summary', 'full']);
		expect(view.sections[0].blocks[0].audiences).toEqual(['technical']);
	});

	it('reports no audiences for an untagged draft', () => {
		const snapshot = {
			version: 1,
			title: 'Plain draft',
			sections: [
				{
					id: 'sec-1',
					title: 'Section one',
					blocks: [{ type: 'text', id: 'ok', paragraphs: [[{ text: 'Plain.' }]] }]
				}
			]
		};
		expect(toPreviewView(snapshot).hasAudiences).toBe(false);
	});

	it('renders valid blocks and flags only the invalid one', () => {
		const snapshot = {
			version: 1,
			title: 'Work in progress',
			sections: [
				{
					id: 'sec-1',
					title: 'Section one',
					blocks: [
						{ type: 'text', id: 'ok', paragraphs: [[{ text: 'Valid paragraph.' }]] },
						// Invalid: image block missing alt and assetId.
						{ type: 'image', id: 'broken' }
					]
				}
			]
		};
		const view = toPreviewView(snapshot);
		expect(view.sections).toHaveLength(1);
		const blocks = view.sections[0].blocks;
		expect(blocks[0].block?.type).toBe('text');
		expect(blocks[1].block).toBeNull();
		expect(blocks[1].invalidNotice).toBeTruthy();
	});

	it('synthesizes a title for an untitled draft', () => {
		const view = toPreviewView({ version: 1, sections: [] });
		expect(view.title).toBe('Untitled report');
	});

	it('does not throw on a wholly malformed snapshot', () => {
		expect(() => toPreviewView(null)).not.toThrow();
		expect(() => toPreviewView({ sections: 'nope' })).not.toThrow();
		expect(toPreviewView(null).sections).toEqual([]);
	});

	it('flags an empty-title section with no blocks as a frame problem', () => {
		const snapshot = {
			version: 1,
			title: 'Draft',
			sections: [{ id: 'sec-1', title: '', blocks: [] }]
		};
		const view = toPreviewView(snapshot);
		expect(view.sections[0].invalid).toBe(true);
		expect(view.sections[0].invalidNotice).toBeTruthy();
		expect(view.sections[0].blocks).toEqual([]);
	});

	it('does not flag the frame when only its blocks are invalid', () => {
		const snapshot = {
			version: 1,
			title: 'Draft',
			sections: [
				{
					id: 'sec-1',
					title: 'Valid title',
					// Every block is invalid; the frame itself is fine, so the section is
					// not frame-invalid - each block surfaces its own notice instead.
					blocks: [
						{ type: 'image', id: 'a' },
						{ type: 'image', id: 'b' }
					]
				}
			]
		};
		const view = toPreviewView(snapshot);
		expect(view.sections[0].invalid).toBe(false);
		expect(view.sections[0].invalidNotice).toBeUndefined();
		const blocks = view.sections[0].blocks;
		expect(blocks.every((b) => b.block === null)).toBe(true);
		expect(blocks.every((b) => b.invalidNotice)).toBe(true);
	});

	it('flags a section whose title is empty but blocks are valid', () => {
		const snapshot = {
			version: 1,
			title: 'Draft',
			sections: [
				{
					id: 'sec-1',
					title: '',
					blocks: [{ type: 'text', id: 'ok', paragraphs: [[{ text: 'Hi.' }]] }]
				}
			]
		};
		const view = toPreviewView(snapshot);
		expect(view.sections[0].invalid).toBe(true);
		expect(view.sections[0].invalidNotice).toBeTruthy();
		// The valid block still renders despite the section-frame problem.
		expect(view.sections[0].blocks[0].block?.type).toBe('text');
	});
});
