import { describe, expect, it } from 'vitest';
import { validateDocument, type DocumentV1 } from '$lib/schema';
import { bakeBindingDeltas } from './bake-delta.ts';

/**
 * Builds a one-section document with a single bound KPI block carrying `value`. The
 * binding makes the block delta-eligible; `binding` false drops it so the
 * static-only case (a hand-typed figure, never a delta) is covered too.
 */
function kpiDocument(
	value: number | string,
	options: { id?: string; binding?: boolean } = {}
): DocumentV1 {
	const id = options.id ?? 'revenue';
	const binding = options.binding ?? true;
	const result = validateDocument({
		version: 1,
		title: 'Quarterly Review',
		sections: [
			{
				id: 'metrics',
				title: 'Metrics',
				blocks: [
					{
						type: 'kpi',
						id,
						items: [{ label: 'Revenue', value }],
						...(binding
							? { binding: { dataSetId: 'ds-1', fields: [{ name: 'revenue', type: 'number' }] } }
							: {})
					}
				]
			}
		]
	});
	if (!result.ok) throw new Error(`fixture invalid: ${JSON.stringify(result.errors.slice(0, 2))}`);
	return result.document;
}

/** The baked delta on the first KPI block of a document, or undefined. */
function bakedDelta(document: DocumentV1) {
	const block = document.sections[0].blocks[0];
	return block.type === 'kpi' ? block.binding?.delta : undefined;
}

describe('bakeBindingDeltas', () => {
	it('bakes an up delta onto an id-matched KPI whose value increased', () => {
		const baked = bakeBindingDeltas(kpiDocument(108), kpiDocument(100));
		expect(bakedDelta(baked)).toEqual({
			direction: 'up',
			priorValue: 100,
			absolute: 8,
			relative: 0.08
		});
	});

	it('bakes a down delta when the value decreased', () => {
		const baked = bakeBindingDeltas(kpiDocument(90), kpiDocument(120));
		expect(bakedDelta(baked)).toEqual({
			direction: 'down',
			priorValue: 120,
			absolute: -30,
			relative: -0.25
		});
	});

	it('bakes a flat delta when the value is unchanged', () => {
		const baked = bakeBindingDeltas(kpiDocument(50), kpiDocument(50));
		expect(bakedDelta(baked)).toEqual({
			direction: 'flat',
			priorValue: 50,
			absolute: 0,
			relative: 0
		});
	});

	it('omits the delta when there is no predecessor snapshot (first issue)', () => {
		const baked = bakeBindingDeltas(kpiDocument(108), null);
		expect(bakedDelta(baked)).toBeUndefined();
	});

	it('omits the delta when the id has no match in the predecessor', () => {
		const baked = bakeBindingDeltas(
			kpiDocument(108, { id: 'revenue' }),
			kpiDocument(100, { id: 'headcount' })
		);
		expect(bakedDelta(baked)).toBeUndefined();
	});

	it('omits the delta when the current value is non-numeric (a string status KPI)', () => {
		const baked = bakeBindingDeltas(kpiDocument('On track'), kpiDocument(100));
		expect(bakedDelta(baked)).toBeUndefined();
	});

	it('does not bake onto a KPI with no binding (a static, hand-typed figure)', () => {
		const baked = bakeBindingDeltas(
			kpiDocument(108, { binding: false }),
			kpiDocument(100, { binding: false })
		);
		const block = baked.sections[0].blocks[0];
		expect(block.type === 'kpi' && block.binding).toBeUndefined();
	});

	it('drops a stale baked delta when the republish has no comparable prior value', () => {
		// A snapshot that already carries a delta, republished against a predecessor whose
		// matching value is now non-numeric: the stale figure must be dropped, not frozen.
		const withDelta = bakeBindingDeltas(kpiDocument(108), kpiDocument(100));
		expect(bakedDelta(withDelta)).toBeDefined();
		const republished = bakeBindingDeltas(withDelta, kpiDocument('n/a'));
		expect(bakedDelta(republished)).toBeUndefined();
	});

	it('is additive: a no-predecessor bake leaves the document deep-equal to the input', () => {
		const input = kpiDocument(108);
		const baked = bakeBindingDeltas(input, null);
		expect(baked).toEqual(input);
	});

	it('does not mutate the input document (rebuilds the spine)', () => {
		const input = kpiDocument(108);
		bakeBindingDeltas(input, kpiDocument(100));
		expect(bakedDelta(input)).toBeUndefined();
	});
});
