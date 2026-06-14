/**
 * A seeded report for the data-as-of caption e2e (Story 6.4, FR16). The
 * `binding.dataAsOf` stamp is baked onto the document server-side at bind/rebind
 * time, so the caption reads straight off the validated document - seeding it
 * directly is the deterministic, minimal route (no upload/inject round-trip). The
 * table block carries an explicit `dataAsOf` (a fixed UTC instant, so the formatted
 * "Data as of 15 Mar 2026" caption is byte-stable regardless of machine locale or
 * clock); the kpi block is bound but carries NO `dataAsOf`, so its block renders no
 * caption at all (omitted, never a placeholder). Published so the seeded author can
 * open it; rendered via the author `/view`.
 */

/** The explicit binding timestamp and the caption it must format to. */
export const DATA_AS_OF_ISO = '2026-03-15T00:00:00.000Z';
export const DATA_AS_OF_CAPTION = 'Data as of 15 Mar 2026';

export const DATA_AS_OF_FIXTURE_DOCUMENT = {
	version: 1 as const,
	title: 'Data Freshness Fixture',
	sections: [
		{
			id: 'stamped',
			title: 'Stamped block',
			blocks: [
				{
					type: 'table' as const,
					id: 'stamped-table',
					columns: [
						{ key: 'metric', label: 'Metric' },
						{ key: 'value', label: 'Value' }
					],
					rows: [
						{ metric: 'Incidents', value: 42 },
						{ metric: 'Open findings', value: 7 }
					],
					binding: {
						dataSetId: 'incident-export',
						dataAsOf: DATA_AS_OF_ISO,
						fields: [
							{ name: 'metric', type: 'string' as const },
							{ name: 'value', type: 'number' as const }
						]
					}
				}
			]
		},
		{
			id: 'unstamped',
			title: 'Unstamped block',
			blocks: [
				{
					type: 'kpi' as const,
					id: 'unstamped-kpi',
					items: [{ label: 'Coverage', value: 96, unit: '%' }],
					binding: {
						fields: [
							{ name: 'label', type: 'string' as const },
							{ name: 'value', type: 'number' as const }
						]
					}
				}
			]
		}
	]
};
