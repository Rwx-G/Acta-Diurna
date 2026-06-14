import { describe, expect, expectTypeOf, it } from 'vitest';
import { validateDocument } from './errors.ts';
import type { DocumentV1 } from './versions/v1.ts';
import { fullDocument } from './examples/full.ts';
import { minimalDocument } from './examples/minimal.ts';
import { drilldownDocument } from './examples/drilldown.ts';
import fullJson from './examples/full.json';
import minimalJson from './examples/minimal.json';
import drilldownJson from './examples/drilldown.json';

describe('document schema v1 - valid documents', () => {
	it('validates the minimal example with full type inference', () => {
		const result = validateDocument(minimalDocument);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expectTypeOf(result.document).toEqualTypeOf<DocumentV1>();
			expect(result.document).toEqual(minimalDocument);
			const block = result.document.sections[0].blocks[0];
			expect(block.type).toBe('text');
			if (block.type === 'text') {
				// discriminated union narrows to the text block shape
				expect(block.paragraphs[0][0].text).toContain('smallest valid');
			}
		}
	});

	it('validates the full example exercising all five block types', () => {
		const result = validateDocument(fullDocument);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const blockTypes = result.document.sections.flatMap((section) =>
				section.blocks.map((block) => block.type)
			);
			expect(new Set(blockTypes)).toEqual(new Set(['text', 'table', 'chart', 'kpi', 'image']));
		}
	});

	it('accepts and preserves audience tags and the annex flag', () => {
		const result = validateDocument(fullDocument);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.document.sections[0].audiences).toEqual(['summary', 'full']);
			expect(result.document.sections[0].blocks[0].audiences).toEqual(['summary']);
			expect(result.document.sections[2].annex).toBe(true);
		}
	});

	it('accepts an optional speaker-notes string on a section, additively (Story 6.2)', () => {
		// A section WITHOUT notes validates unchanged (the field is optional, no
		// version bump); a section WITH notes preserves them for the presenter view.
		const withNotes = validateDocument({
			version: 1,
			title: 'Briefed Report',
			sections: [
				{
					id: 'overview',
					title: 'Overview',
					notes: 'Open with the headline number.',
					blocks: [{ type: 'text', id: 'intro', paragraphs: [[{ text: 'All good.' }]] }]
				}
			]
		});
		expect(withNotes.ok).toBe(true);
		if (withNotes.ok) {
			expect(withNotes.document.sections[0].notes).toBe('Open with the headline number.');
			expect(withNotes.document.version).toBe(1);
		}
		// The full fixture has no notes and still validates, proving additivity.
		const noNotes = validateDocument(fullDocument);
		expect(noNotes.ok).toBe(true);
		if (noNotes.ok) {
			expect(noNotes.document.sections.every((section) => section.notes === undefined)).toBe(true);
		}
	});

	it("accepts an optional kind: 'detail' on a section, additively (Epic 11)", () => {
		// A section WITHOUT `kind` validates unchanged (the field is optional, the
		// default is a main-flow section); a section WITH kind: 'detail' parses with
		// full types and keeps its id/title/audiences/notes/blocks like a flow
		// section - no new block path.
		const result = validateDocument({
			version: 1,
			title: 'Drill-down report',
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
					audiences: ['technical'],
					notes: 'Author cue for the detail page.',
					blocks: [{ type: 'text', id: 'evidence', paragraphs: [[{ text: 'Full evidence.' }]] }]
				}
			]
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.document.sections[0].kind).toBeUndefined();
			expect(result.document.sections[1].kind).toBe('detail');
			expect(result.document.sections[1].audiences).toEqual(['technical']);
			expect(result.document.sections[1].notes).toBe('Author cue for the detail page.');
			expect(result.document.sections[1].blocks[0].id).toBe('evidence');
		}
		// The full fixture sets no `kind` and still validates, proving additivity.
		const noKind = validateDocument(fullDocument);
		expect(noKind.ok).toBe(true);
		if (noKind.ok) {
			expect(noKind.document.sections.every((section) => section.kind === undefined)).toBe(true);
		}
	});

	it("rejects a section that sets both annex and kind: 'detail' (Epic 11, FR2 parity)", () => {
		const result = validateDocument({
			version: 1,
			title: 'Conflicting placement',
			sections: [
				{
					id: 'both-placements',
					title: 'Both placements',
					annex: true,
					kind: 'detail',
					blocks: [{ type: 'text', id: 'body', paragraphs: [[{ text: 'Body.' }]] }]
				}
			]
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const issue = result.errors.find((error) => error.path === 'sections[0].kind');
			expect(issue).toBeDefined();
			expect(issue?.message).toContain('both-placements');
			expect(issue?.message).toContain('mutually exclusive');
			expect(issue?.hint).toBeTruthy();
		}
	});

	it('accepts a linkTo on an inline run, a table row, and a matrix finding (Epic 11)', () => {
		// Each carrier gains an additive, optional `linkTo` (a section id). The target
		// section exists, so the cross-reference pass passes.
		const result = validateDocument({
			version: 1,
			title: 'Drill-down report',
			scales: [
				{ key: 'severity', label: 'Severity', entries: [{ key: 'high', label: 'High' }] },
				{ key: 'sources', label: 'Sources', entries: [{ key: 'siem', label: 'SIEM' }] }
			],
			sections: [
				{
					id: 'overview',
					title: 'Overview',
					blocks: [
						{
							type: 'text',
							id: 'intro',
							paragraphs: [[{ text: 'See ' }, { text: 'the finding', linkTo: 'finding-detail' }]]
						},
						{
							type: 'table',
							id: 'rows',
							columns: [{ key: 'name', label: 'Name' }],
							rows: [{ name: 'Row A' }, { name: 'Row B' }],
							rowLinks: ['finding-detail', null]
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
									linkTo: 'finding-detail'
								}
							]
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
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const [text, table, matrix] = result.document.sections[0].blocks;
			if (text.type === 'text') {
				expect(text.paragraphs[0][1].linkTo).toBe('finding-detail');
			} else {
				expect.fail('expected a text block');
			}
			if (table.type === 'table') {
				expect(table.rowLinks).toEqual(['finding-detail', null]);
			} else {
				expect.fail('expected a table block');
			}
			if (matrix.type === 'comparison-matrix') {
				expect(matrix.findings[0].linkTo).toBe('finding-detail');
			} else {
				expect.fail('expected a comparison-matrix block');
			}
		}
	});

	it('rejects an inline run carrying both linkTo and an external link (Epic 11, FR2 parity)', () => {
		const result = validateDocument({
			version: 1,
			title: 'Conflicting link',
			sections: [
				{
					id: 'overview',
					title: 'Overview',
					blocks: [
						{
							type: 'text',
							id: 'intro',
							paragraphs: [
								[{ text: 'both', linkTo: 'overview', link: { href: 'https://example.com' } }]
							]
						}
					]
				}
			]
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const issue = result.errors.find((e) => e.path.endsWith('linkTo'));
			expect(issue?.path).toBe('sections[0].blocks[0].paragraphs[0][0].linkTo');
			expect(issue?.message).toContain('mutually exclusive');
			expect(issue?.hint).toBeTruthy();
		}
	});

	it('accepts static data, a binding, or both on data-bound blocks', () => {
		const result = validateDocument(fullDocument);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const chart = result.document.sections[1].blocks[0];
			if (chart.type === 'chart') {
				expect(chart.series).toHaveLength(1);
				expect(chart.binding?.dataSetId).toBe('incident-export-q2');
			} else {
				expect.fail('expected a chart block');
			}
			const kpi = result.document.sections[2].blocks[0];
			if (kpi.type === 'kpi') {
				expect(kpi.items).toBeUndefined();
				expect(kpi.binding?.dataSetId).toBeUndefined();
				expect(kpi.binding?.fields).toHaveLength(2);
			} else {
				expect.fail('expected a kpi block');
			}
		}
	});

	it('keeps a binding with no per-field slot valid (additive 2.4 contract stays v1-valid)', () => {
		// A document written before the 2.4 slot extension: binding fields carry
		// name+type only, no `slot`. It must still validate unchanged.
		const result = validateDocument({
			version: 1,
			title: 'Slotless',
			sections: [
				{
					id: 'data',
					title: 'Data',
					blocks: [
						{
							type: 'table',
							id: 'legacy-table',
							columns: [{ key: 'item', label: 'Item' }],
							binding: { fields: [{ name: 'item', type: 'string' }] }
						}
					]
				}
			]
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const table = result.document.sections[0].blocks[0];
			if (table.type === 'table') {
				expect(table.binding?.fields[0].slot).toBeUndefined();
			} else {
				expect.fail('expected a table block');
			}
		}
	});

	it('accepts per-field slot mappings for table/chart/kpi bindings', () => {
		const result = validateDocument({
			version: 1,
			title: 'Slotted',
			sections: [
				{
					id: 'data',
					title: 'Data',
					blocks: [
						{
							type: 'chart',
							id: 'bound-chart',
							kind: 'line',
							binding: {
								fields: [
									{ name: 'week', type: 'date', slot: { role: 'x' } },
									{ name: 'count', type: 'number', slot: { role: 'y', seriesName: 'Incidents' } }
								]
							}
						}
					]
				}
			]
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const chart = result.document.sections[0].blocks[0];
			if (chart.type === 'chart') {
				expect(chart.binding?.fields[0].slot?.role).toBe('x');
				expect(chart.binding?.fields[1].slot?.seriesName).toBe('Incidents');
			} else {
				expect.fail('expected a chart block');
			}
		}
	});

	it('rejects an unknown slot role', () => {
		const result = validateDocument({
			version: 1,
			title: 'Bad slot',
			sections: [
				{
					id: 'data',
					title: 'Data',
					blocks: [
						{
							type: 'table',
							id: 'bad-table',
							columns: [{ key: 'item', label: 'Item' }],
							binding: { fields: [{ name: 'item', type: 'string', slot: { role: 'series' } }] }
						}
					]
				}
			]
		});
		expect(result.ok).toBe(false);
	});

	it('validates a v1 document with no scales unchanged (Epic 7 additivity)', () => {
		// `scales` is additive and optional: a document written before Epic 7 must
		// validate and parse byte-identically, with no `scales` key introduced.
		const result = validateDocument(minimalDocument);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.document).toEqual(minimalDocument);
			expect('scales' in result.document).toBe(false);
		}
	});

	it('accepts and preserves document-level scales (Epic 7)', () => {
		const result = validateDocument(fullDocument);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.document.scales?.[0].key).toBe('severity');
			expect(result.document.scales?.[0].entries[0].color).toBe('#7a2e3a');
			expect(result.document.scales?.[1].kind).toBe('nominal');
		}
	});

	it('applies table option defaults on parse', () => {
		const result = validateDocument({
			version: 1,
			title: 'Defaults',
			sections: [
				{
					id: 'data',
					title: 'Data',
					blocks: [
						{
							type: 'table',
							id: 'plain-table',
							columns: [{ key: 'name', label: 'Name' }],
							rows: [{ name: 'one' }],
							options: {}
						}
					]
				}
			]
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const table = result.document.sections[0].blocks[0];
			if (table.type === 'table') {
				expect(table.options?.stickyHeader).toBe(true);
			} else {
				expect.fail('expected a table block');
			}
		}
	});
});

describe('document schema v1 - serialized example copies', () => {
	it('keeps minimal.json in sync with the typed constant and valid', () => {
		expect(minimalJson).toEqual(minimalDocument);
		expect(validateDocument(minimalJson).ok).toBe(true);
	});

	it('keeps full.json in sync with the typed constant and valid', () => {
		expect(fullJson).toEqual(fullDocument);
		expect(validateDocument(fullJson).ok).toBe(true);
	});

	it('keeps drilldown.json in sync with the typed constant and valid (Story 11.5)', () => {
		expect(drilldownJson).toEqual(drilldownDocument);
		const result = validateDocument(drilldownJson);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		// The drill-down example reaches a `kind: 'detail'` page through a `linkTo`
		// (a table rowLink), so an agent reading the examples discovers the shape.
		const detail = result.document.sections.find((section) => section.kind === 'detail');
		expect(detail).toBeDefined();
		const table = result.document.sections
			.flatMap((section) => section.blocks)
			.find((block) => block.type === 'table');
		expect(table?.type === 'table' && table.rowLinks).toContain(detail!.id);
	});

	it('round-trips through JSON serialization', () => {
		const roundTripped: unknown = JSON.parse(JSON.stringify(fullDocument));
		expect(roundTripped).toEqual(fullDocument);
		expect(validateDocument(roundTripped).ok).toBe(true);
	});
});
