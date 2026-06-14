/**
 * A seeded report on the WARM MERIDIAN theme (Story 6.5, FR39). The shared full
 * fixture already exercises the COOL AURORA theme end to end (its `theme` is
 * `aurora`, and the reader axe e2e runs on it), so the two non-default light
 * identities are both gated under axe-core: aurora via the full fixture, meridian
 * via this one. The renderer maps the document `theme` slug to a `data-theme`
 * attribute, so seeding `theme: 'meridian'` renders the whole surface under the
 * meridian token block (cream paper, sepia ink, terracotta accent). Content is
 * deliberately broad-but-small - a cover, a KPI strip, a rich-text paragraph with
 * inline marks, a table and a chip-cluster off a document scale - so axe sees a
 * representative chunk of the render under the theme without disturbing any other
 * fixture's snapshots. NFR14.
 */
export const MERIDIAN_FIXTURE_DOCUMENT = {
	version: 1 as const,
	title: 'Warm Meridian Fixture',
	theme: 'meridian',
	scales: [
		{
			key: 'status',
			label: 'Status',
			kind: 'ordinal' as const,
			entries: [
				{ key: 'done', label: 'Done' },
				{ key: 'in-progress', label: 'In progress' },
				{ key: 'planned', label: 'Planned' }
			]
		}
	],
	sections: [
		{
			id: 'overview',
			title: 'Overview',
			blocks: [
				{
					type: 'kpi' as const,
					id: 'headline',
					items: [
						{ label: 'Releases', value: 12, trend: 'up' as const },
						{ label: 'Open issues', value: 4, trend: 'down' as const }
					]
				},
				{
					type: 'text' as const,
					id: 'narrative',
					paragraphs: [
						[
							{ text: 'The quarter closed ' },
							{ text: 'ahead of plan', bold: true },
							{ text: ' on the ' },
							{ text: 'meridian', code: true },
							{ text: ' theme.' }
						]
					]
				}
			]
		},
		{
			id: 'detail',
			title: 'Detail',
			blocks: [
				{
					type: 'table' as const,
					id: 'workstreams',
					columns: [
						{ key: 'name', label: 'Workstream' },
						{ key: 'state', label: 'State', scaleRef: 'status' }
					],
					rows: [
						{ name: 'Ingestion', state: 'done' },
						{ name: 'Sharing', state: 'in-progress' },
						{ name: 'Editor', state: 'planned' }
					]
				},
				{
					type: 'chip-cluster' as const,
					id: 'states',
					scaleRef: 'status',
					title: 'Tracked states',
					entries: ['done', 'in-progress', 'planned']
				}
			]
		}
	]
};
