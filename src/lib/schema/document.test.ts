import { describe, expect, expectTypeOf, it } from 'vitest';
import { validateDocument } from './errors.ts';
import type { DocumentV1 } from './versions/v1.ts';
import { fullDocument } from './examples/full.ts';
import { minimalDocument } from './examples/minimal.ts';
import fullJson from './examples/full.json';
import minimalJson from './examples/minimal.json';

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

	it('round-trips through JSON serialization', () => {
		const roundTripped: unknown = JSON.parse(JSON.stringify(fullDocument));
		expect(roundTripped).toEqual(fullDocument);
		expect(validateDocument(roundTripped).ok).toBe(true);
	});
});
