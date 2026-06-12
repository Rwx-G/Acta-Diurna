import { describe, expect, it } from 'vitest';
import { toPreviewView, toReportView } from './document-view.ts';
import { fullDocument } from '$lib/schema/examples/full.ts';
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
});

describe('toPreviewView (transiently-invalid tolerance)', () => {
	it('takes the fast path for a fully valid snapshot', () => {
		const view = toPreviewView(fullDocument);
		expect(view.sections).toHaveLength(3);
		expect(view.sections.every((s) => !s.invalid)).toBe(true);
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
