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

/**
 * Builds a one-section document with a single bound, multi-item KPI block. A
 * binding-level delta is ambiguous for a multi-item KPI (which item does it annotate?),
 * so the bake omits it.
 */
function multiItemKpiDocument(...values: number[]): DocumentV1 {
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
						id: 'revenue',
						items: values.map((value, index) => ({ label: `Metric ${index}`, value })),
						binding: { dataSetId: 'ds-1', fields: [{ name: 'revenue', type: 'number' }] }
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

/** Strips every `binding.delta` so two documents can be compared modulo the delta. */
function withoutDeltas(document: DocumentV1): DocumentV1 {
	return {
		...document,
		sections: document.sections.map((section) => ({
			...section,
			blocks: section.blocks.map((block) => {
				if (block.type !== 'kpi' || block.binding?.delta === undefined) return block;
				const binding = { ...block.binding };
				delete binding.delta;
				return { ...block, binding };
			})
		}))
	};
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

	it('omits the delta for a multi-item KPI (a binding-level delta is ambiguous there)', () => {
		// A two-item KPI carries no single binding-level figure: a delta would silently
		// annotate item 0 only. The bake omits it rather than baking an unlabelled,
		// misleading delta (omit-rather-than-mislead).
		const baked = bakeBindingDeltas(multiItemKpiDocument(108, 50), multiItemKpiDocument(100, 40));
		expect(bakedDelta(baked)).toBeUndefined();
	});

	it('bakes against an UNBOUND predecessor KPI of the same id (the prior value is value-only)', () => {
		// The current KPI is bound (delta-eligible); its predecessor at the same id is a
		// static, hand-typed KPI with no binding. The prior value is comparable regardless
		// of whether the predecessor declared a binding, so the delta bakes.
		const baked = bakeBindingDeltas(
			kpiDocument(108, { binding: true }),
			kpiDocument(100, { binding: false })
		);
		expect(bakedDelta(baked)).toEqual({
			direction: 'up',
			priorValue: 100,
			absolute: 8,
			relative: 0.08
		});
	});

	it('omits the delta when the predecessor KPI value is non-numeric (a string status)', () => {
		const baked = bakeBindingDeltas(kpiDocument(108), kpiDocument('On track'));
		expect(bakedDelta(baked)).toBeUndefined();
	});

	it('leaves the document deep-equal to the input except for the baked delta', () => {
		// The bake is structure-preserving: it only adds/removes the optional binding delta.
		// This is the post-condition `publishReport` trusts in place of a second full
		// schema walk.
		const input = kpiDocument(108);
		const baked = bakeBindingDeltas(input, kpiDocument(100));
		expect(bakedDelta(baked)).toBeDefined();
		expect(withoutDeltas(baked)).toEqual(input);
	});
});
