/**
 * Seeded reports for the numeric delta e2e (Story 9.4). The `binding.delta`
 * annotation is precomputed onto the binding SERVER-SIDE at publish time (the
 * `data_as_of` precedent), frozen into the published snapshot, and read straight off
 * the validated document by the PURE renderer - so seeding the baked delta directly
 * is the deterministic, minimal route (no duplicate/publish round-trip in the spec).
 *
 * Two issues of one series:
 * - The FIRST issue carries a bound KPI with NO delta (no predecessor to compare), so
 *   its rendered block shows the value alone - the indicator is omitted, never a
 *   misleading zero.
 * - The SECOND issue carries the SAME bound KPI id with a baked up-delta (revenue rose
 *   from 1.0M to 1.2M: +0.2 / +20%), so its rendered block shows the up arrow + signed
 *   figure with the accessible direction word.
 *
 * Both render through the author `/view` (the same render component a reader sees), so
 * the delta is seeded onto BOTH the draft `document` and the `publishedDocument` (the
 * annotation is a valid optional binding field; `/view` renders the draft). The
 * publish-time bake itself is covered by the `publishReport` unit tests.
 */

const REVENUE_BINDING_FIELDS = [{ name: 'revenue', type: 'number' as const }];

/** The first issue: a bound KPI with no delta (the omit-when-no-predecessor case). */
export const DELTA_FIRST_ISSUE_DOCUMENT = {
	version: 1 as const,
	title: 'Series Issue 1',
	sections: [
		{
			id: 'metrics',
			title: 'Metrics',
			blocks: [
				{
					type: 'kpi' as const,
					id: 'revenue-kpi',
					items: [{ label: 'Revenue', value: 1_000_000, unit: 'USD' }],
					binding: { dataSetId: 'revenue-export', fields: REVENUE_BINDING_FIELDS }
				}
			]
		}
	]
};

const COST_BINDING_FIELDS = [{ name: 'cost', type: 'number' as const }];

/**
 * The second issue: the same revenue KPI id with a baked UP-delta against issue 1, plus
 * a second cost KPI carrying a baked DOWN-delta, so the render e2e exercises both
 * directions (and the down case in the axe pass).
 */
export const DELTA_SECOND_ISSUE_DOCUMENT = {
	version: 1 as const,
	title: 'Series Issue 2',
	sections: [
		{
			id: 'metrics',
			title: 'Metrics',
			blocks: [
				{
					type: 'kpi' as const,
					id: 'revenue-kpi',
					items: [{ label: 'Revenue', value: 1_200_000, unit: 'USD' }],
					binding: {
						dataSetId: 'revenue-export',
						delta: {
							direction: 'up' as const,
							priorValue: 1_000_000,
							absolute: 200_000,
							relative: 0.2
						},
						fields: REVENUE_BINDING_FIELDS
					}
				},
				{
					type: 'kpi' as const,
					id: 'cost-kpi',
					items: [{ label: 'Cost', value: 80_000, unit: 'USD' }],
					binding: {
						dataSetId: 'cost-export',
						delta: {
							direction: 'down' as const,
							priorValue: 100_000,
							absolute: -20_000,
							relative: -0.2
						},
						fields: COST_BINDING_FIELDS
					}
				}
			]
		}
	]
};

/** The signed figure the second issue's UP delta indicator must render. */
export const DELTA_SECOND_ISSUE_FIGURE = '+200,000 (+20%)';

/** The signed figure the second issue's DOWN delta indicator must render. */
export const DELTA_SECOND_ISSUE_DOWN_FIGURE = '-20,000 (-20%)';
