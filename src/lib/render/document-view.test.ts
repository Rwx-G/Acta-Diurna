import { describe, expect, it } from 'vitest';
import { toPreviewView, toReportView, type ReportView } from './document-view.ts';
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

	it('never carries author-only speaker notes onto the reader view-model (Story 6.2 privacy)', () => {
		// Speaker notes are authored for the presenter only. The reader view-model
		// the SSR HTML renders from must not include them, so a reader (rendered
		// HTML or any JSON the reader route serializes) cannot see them.
		const doc = validFull();
		const briefed: DocumentV1 = {
			...doc,
			sections: doc.sections.map((section, index) =>
				index === 0 ? { ...section, notes: 'Confidential presenter cue.' } : section
			)
		};
		const view = toReportView(briefed);
		expect(view.sections[0]).not.toHaveProperty('notes');
		expect(JSON.stringify(view)).not.toContain('Confidential presenter cue.');
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

describe('toReportView - detail sections (Epic 11)', () => {
	function withDetail(): DocumentV1 {
		const doc = validFull();
		// Append a detail section to the validated full document. It carries an
		// audience tag so the hasAudiences-counts-detail case can isolate it.
		const detail: DocumentV1['sections'][number] = {
			id: 'finding-117-detail',
			title: 'Finding 2026-117 detail',
			kind: 'detail',
			audiences: ['technical'],
			blocks: [
				{ type: 'text', id: 'evidence', paragraphs: [[{ text: 'Full evidence and remediation.' }]] }
			]
		};
		return { ...doc, sections: [...doc.sections, detail] };
	}

	it('excludes detail sections from the main-flow sequence and the TOC', () => {
		const view = toReportView(withDetail());
		// The full fixture has three main-flow sections; the detail section is the
		// fourth document section but must NOT appear in the main-flow sequence.
		expect(view.sections.map((s) => s.id)).toEqual([
			'executive-summary',
			'incident-analysis',
			'methodology'
		]);
		expect(view.sections.some((s) => s.id === 'finding-117-detail')).toBe(false);
		// ...nor in the TOC.
		expect(view.toc.some((t) => t.id === 'finding-117-detail')).toBe(false);
	});

	it('keeps detail sections present and rendered with their stable anchor id', () => {
		const view = toReportView(withDetail());
		expect(view.detailSections.map((s) => s.id)).toEqual(['finding-117-detail']);
		const detail = view.detailSections[0];
		expect(detail.detail).toBe(true);
		// The section id is the deep-link anchor a later internal link reaches; the
		// blocks carry their stable per-block anchors, so the page is fully rendered.
		expect(detail.id).toBe('finding-117-detail');
		expect(detail.blocks[0].block).not.toBeNull();
		expect(detail.blocks[0].anchorId).toBe('finding-117-detail--evidence');
	});

	it('the main-flow count the navigation reads excludes detail sections', () => {
		const view = toReportView(withDetail());
		// The navigation, progress rail and keyboard paging are driven by
		// view.sections.length; a detail page must never grow that count.
		expect(view.sections).toHaveLength(3);
		expect(view.detailSections).toHaveLength(1);
	});

	it('counts detail-section audience tags toward hasAudiences (Epic 11 default)', () => {
		// A document whose ONLY audience tags live on a detail section still surfaces
		// the level switcher (hasAudiences true).
		const doc = validFull();
		const stripped = doc.sections.map((section) => ({
			...section,
			audiences: undefined,
			blocks: section.blocks.map((block) => ({ ...block, audiences: undefined }))
		}));
		const detail: DocumentV1['sections'][number] = {
			id: 'detail-only-tag',
			title: 'Detail-only tag',
			kind: 'detail',
			audiences: ['technical'],
			blocks: [{ type: 'text', id: 'deep', paragraphs: [[{ text: 'Deep.' }]] }]
		};
		const onlyDetailTagged: DocumentV1 = { ...doc, sections: [...stripped, detail] };
		const view = toReportView(onlyDetailTagged);
		expect(view.sections.every((s) => s.audiences === undefined)).toBe(true);
		expect(view.hasAudiences).toBe(true);
	});

	it('renders a no-kind document byte-unchanged (additivity, N/N-1)', () => {
		// A document with no `kind` on any section produces exactly the view it did
		// before Epic 11: every section is main-flow, detailSections is empty, and
		// the main-flow sequence and TOC are unchanged. The detail addition is purely
		// additive (a new empty array and a `detail: false` flag), so the rendered
		// HTML the reader sees is identical.
		const view = toReportView(validFull());
		expect(view.sections).toHaveLength(3);
		expect(view.detailSections).toEqual([]);
		expect(view.sections.every((s) => s.detail === false)).toBe(true);
		expect(view.toc.map((t) => t.id)).toEqual([
			'executive-summary',
			'incident-analysis',
			'methodology'
		]);
		// The serialized reader view carries no `kind`-derived noise beyond the flag:
		// stringifying drops the `false` only when absent, so assert the flag is the
		// sole additive surface and the section payload is otherwise intact.
		const serialized = JSON.parse(JSON.stringify(view)) as ReportView;
		expect(serialized.detailSections).toEqual([]);
		expect(serialized.sections).toHaveLength(3);
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

	it('partitions detail sections out of the main flow and the TOC (Epic 11)', () => {
		const snapshot = {
			version: 1,
			title: 'Drill-down draft',
			sections: [
				{
					id: 'overview',
					title: 'Overview',
					blocks: [{ type: 'text', id: 'intro', paragraphs: [[{ text: 'See the finding.' }]] }]
				},
				{
					id: 'finding-detail',
					title: 'Finding detail',
					kind: 'detail',
					blocks: [{ type: 'text', id: 'evidence', paragraphs: [[{ text: 'Evidence.' }]] }]
				}
			]
		};
		const view = toPreviewView(snapshot);
		expect(view.sections.map((s) => s.id)).toEqual(['overview']);
		expect(view.toc.map((t) => t.id)).toEqual(['overview']);
		expect(view.detailSections.map((s) => s.id)).toEqual(['finding-detail']);
		expect(view.detailSections[0].detail).toBe(true);
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

	it('never carries author-only speaker notes onto the editor preview view-model (Story 10.6 privacy)', () => {
		// The editor's live preview renders from `toPreviewView`. Speaker notes are an
		// author-only affordance edited on the working copy (Story 10.6) and must not
		// surface in the reader-facing render the preview shows - the preview is the
		// author's, but it IS the reader output, and notes are not part of it. The
		// render tier never reads `notes`, so a draft snapshot carrying notes produces a
		// view-model free of them (no property, no value anywhere in the serialized view).
		const snapshot = {
			version: 1,
			title: 'Briefed draft',
			sections: [
				{
					id: 'sec-1',
					title: 'Section one',
					notes: 'Confidential presenter cue in the draft.',
					blocks: [{ type: 'text', id: 'ok', paragraphs: [[{ text: 'Plain.' }]] }]
				}
			]
		};
		const view = toPreviewView(snapshot);
		expect(view.sections[0]).not.toHaveProperty('notes');
		expect(JSON.stringify(view)).not.toContain('Confidential presenter cue in the draft.');
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

describe('toPreviewView - dangling internal links (Story 11.5)', () => {
	it('surfaces a not-yet-existing linkTo target as a gentle notice, never throwing', () => {
		// The author wrote an internal link to a detail page they have not authored
		// yet. The preview must render what it can AND name the dangling target, so
		// the author keeps editing - it does not blank or throw.
		const snapshot = {
			version: 1,
			title: 'Drill-down in progress',
			sections: [
				{
					id: 'overview',
					title: 'Overview',
					blocks: [
						{
							type: 'text',
							id: 'intro',
							paragraphs: [[{ text: 'See ' }, { text: 'the finding', linkTo: 'finding-detail' }]]
						}
					]
				}
			]
		};
		let view!: ReturnType<typeof toPreviewView>;
		expect(() => (view = toPreviewView(snapshot))).not.toThrow();
		// The prose block still renders (the preview is tolerant, not all-or-nothing).
		expect(view.sections[0].blocks[0].block?.type).toBe('text');
		// ...and the dangling target is surfaced, named, actionable.
		expect(view.danglingLinks).toHaveLength(1);
		expect(view.danglingLinks[0].target).toBe('finding-detail');
		expect(view.danglingLinks[0].message).toContain('finding-detail');
		expect(view.danglingLinks[0].message).toContain('publish');
	});

	it('surfaces a dangling linkTo from a table row and a matrix finding', () => {
		const snapshot = {
			version: 1,
			title: 'Carriers',
			scales: [
				{ key: 'severity', label: 'Severity', entries: [{ key: 'high', label: 'High' }] },
				{ key: 'sources', label: 'Sources', entries: [{ key: 'siem', label: 'SIEM' }] }
			],
			sections: [
				{
					id: 'findings',
					title: 'Findings',
					blocks: [
						{
							type: 'table',
							id: 'rows',
							columns: [{ key: 'name', label: 'Name' }],
							rows: [{ name: 'Row A' }],
							rowLinks: ['missing-row-detail']
						},
						{
							type: 'comparison-matrix',
							id: 'matrix',
							severityScale: 'severity',
							sourceScale: 'sources',
							findings: [
								{
									category: 'Access',
									label: 'Weak policy',
									severity: 'high',
									sources: { siem: { state: 'found' } },
									treatment: { before: 'a', after: 'b', status: 'action' },
									linkTo: 'missing-finding-detail'
								}
							]
						}
					]
				}
			]
		};
		const view = toPreviewView(snapshot);
		const targets = view.danglingLinks.map((notice) => notice.target).sort();
		expect(targets).toEqual(['missing-finding-detail', 'missing-row-detail']);
	});

	it('does not surface a linkTo whose target section exists in the snapshot', () => {
		const snapshot = {
			version: 1,
			title: 'Resolved',
			sections: [
				{
					id: 'overview',
					title: 'Overview',
					blocks: [
						{
							type: 'text',
							id: 'intro',
							paragraphs: [[{ text: 'See ' }, { text: 'the detail', linkTo: 'finding-detail' }]]
						}
					]
				},
				{
					id: 'finding-detail',
					title: 'Finding detail',
					kind: 'detail',
					blocks: [{ type: 'text', id: 'evidence', paragraphs: [[{ text: 'Evidence.' }]] }]
				}
			]
		};
		expect(toPreviewView(snapshot).danglingLinks).toEqual([]);
	});

	it('deduplicates by target so one missing page reached twice reads as one notice', () => {
		const snapshot = {
			version: 1,
			title: 'Two links one target',
			sections: [
				{
					id: 'overview',
					title: 'Overview',
					blocks: [
						{
							type: 'text',
							id: 'intro',
							paragraphs: [
								[{ text: 'A', linkTo: 'finding-detail' }],
								[{ text: 'B', linkTo: 'finding-detail' }]
							]
						}
					]
				}
			]
		};
		const view = toPreviewView(snapshot);
		expect(view.danglingLinks).toHaveLength(1);
		expect(view.danglingLinks[0].target).toBe('finding-detail');
	});

	it('reports no dangling links for a snapshot with no linkTo at all', () => {
		expect(toPreviewView(fullDocument).danglingLinks).toEqual([]);
	});
});
