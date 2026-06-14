/**
 * A seeded report on the DEFAULT theme carrying every Epic 7 Phase B block: the
 * callout (story 7.7, both info and danger tones, with icon + kicker + an
 * inline-code body run), the code block (story 7.8, multi-line with a language
 * caption), the card grid (story 7.9, with and without an icon), the structured
 * list (story 7.10, an ordered steps list and an unordered list, each with a
 * rich-text description), the timeline (story 7.11, milestones each carrying a
 * status badge), the chip-cluster (story 7.5), and a table with a `scaleRef`
 * status column (story 7.5). The component-level a11y work asserts these blocks
 * in isolation; this fixture is what gates them under axe-core on the rendered
 * reader surface, default theme, desktop and mobile (NFR14). Kept separate from
 * the full and matrix fixtures so the axe check runs on the default theme without
 * disturbing their snapshots. The `progress` and `phase` scales are declared at
 * document level; the timeline, chip-cluster and table reference them by key, so
 * this fixture is the complete Phase B surface rendered end to end.
 */
export const PHASE_B_FIXTURE_DOCUMENT = {
	version: 1 as const,
	title: 'Phase B Blocks Fixture',
	scales: [
		{
			key: 'progress',
			label: 'Progress',
			kind: 'ordinal' as const,
			entries: [
				{ key: 'done', label: 'Done' },
				{ key: 'in-progress', label: 'In progress' },
				{ key: 'planned', label: 'Planned' }
			]
		},
		{
			key: 'phase',
			label: 'Phase',
			kind: 'nominal' as const,
			entries: [
				{ key: 'discovery', label: 'Discovery' },
				{ key: 'delivery', label: 'Delivery' },
				{ key: 'review', label: 'Review' }
			]
		}
	],
	sections: [
		{
			id: 'callouts',
			title: 'Callouts',
			blocks: [
				{
					type: 'callout' as const,
					id: 'callout-info',
					tone: 'info' as const,
					icon: 'info' as const,
					kicker: 'Note',
					body: [
						[
							{ text: 'Run ' },
							{ text: 'pnpm check', code: true },
							{ text: ' before opening a pull request.' }
						]
					]
				},
				{
					type: 'callout' as const,
					id: 'callout-danger',
					tone: 'danger' as const,
					icon: 'alert' as const,
					kicker: 'Critical',
					body: [
						[
							{ text: 'Rotate the exposed token ' },
							{ text: 'immediately', bold: true },
							{ text: '; it grants write access to the API.' }
						]
					]
				}
			]
		},
		{
			id: 'code-and-cards',
			title: 'Code and cards',
			blocks: [
				{
					type: 'code' as const,
					id: 'code-snippet',
					language: 'bash',
					code: 'pnpm install\npnpm build\nnode build',
					annotations: [{ line: 3, text: 'Boots the production server on $PORT.' }]
				},
				{
					type: 'card-grid' as const,
					id: 'card-grid',
					columns: 2,
					items: [
						{
							icon: 'shield' as const,
							title: 'Hardened by default',
							description: 'Strict CSP, no third-party assets, passwordless author auth.'
						},
						{
							title: 'Trivial deployment',
							description: 'Clone, configure env, then docker compose up.'
						}
					]
				}
			]
		},
		{
			id: 'lists',
			title: 'Lists',
			blocks: [
				{
					type: 'list' as const,
					id: 'steps',
					ordered: true,
					items: [
						{
							term: 'Clone',
							description: [
								[
									{ text: 'Pull the repository and check out ' },
									{ text: 'main', code: true },
									{ text: '.' }
								]
							]
						},
						{
							term: 'Configure',
							description: [[{ text: 'Copy the sample env file and set the database URL.' }]]
						},
						{
							term: 'Launch',
							description: [[{ text: 'Bring the stack up and wait for the health check.' }]]
						}
					]
				},
				{
					type: 'list' as const,
					id: 'checklist',
					ordered: false,
					items: [
						{
							term: 'Backups',
							description: [
								[
									{ text: 'Nightly dump of the ' },
									{ text: 'reports', code: true },
									{ text: ' table.' }
								]
							]
						},
						{
							term: 'Monitoring',
							description: [
								[
									{ text: 'Alert on a failing ' },
									{ text: 'healthz', code: true },
									{ text: ' probe.' }
								]
							]
						}
					]
				}
			]
		},
		{
			id: 'timeline-chips-table',
			title: 'Roadmap and status',
			blocks: [
				{
					type: 'timeline' as const,
					id: 'roadmap',
					title: 'Delivery roadmap',
					milestones: [
						{
							label: 'Schema foundation',
							date: 'Q1 2026',
							detail: [[{ text: 'The versioned document model and validation.' }]],
							status: { scaleRef: 'progress', entry: 'done' }
						},
						{
							label: 'Reader rendering',
							date: 'Q2 2026',
							detail: [[{ text: 'Hybrid slides and scroll on the default theme.' }]],
							status: { scaleRef: 'progress', entry: 'in-progress' }
						},
						{
							label: 'WYSIWYG editor',
							date: 'Q3 2026',
							status: { scaleRef: 'progress', entry: 'planned' }
						}
					]
				},
				{
					type: 'chip-cluster' as const,
					id: 'phases',
					scaleRef: 'phase',
					title: 'Active phases',
					entries: ['discovery', 'delivery', 'review']
				},
				{
					type: 'table' as const,
					id: 'workstreams',
					columns: [
						{ key: 'name', label: 'Workstream' },
						{ key: 'state', label: 'State', scaleRef: 'progress' }
					],
					rows: [
						{ name: 'Ingestion', state: 'done' },
						{ name: 'Sharing', state: 'in-progress' },
						{ name: 'Editor', state: 'planned' }
					]
				}
			]
		}
	]
};
