/**
 * Shared constants for the e2e harness: the test author password (its argon2
 * hash is derived at setup time so it stays reproducible across machines/CI),
 * and the seeded fixture report (the schema full example) with a fixed id so
 * the reader-view specs can navigate to a known URL.
 */
import { fullDocument } from '../src/lib/schema/examples/full.ts';

export const E2E_PORT = 4173;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

/** Where the `setup` project saves the authenticated author storage state. */
export const AUTH_STATE = 'e2e/.auth/author.json';

/**
 * Where globalSetup writes the ephemeral testcontainer DATABASE_URL, for specs
 * that need a direct DB seam (the reader-verification spec). Gitignored with the
 * rest of `.auth/`.
 */
export const DB_URL_FILE = 'e2e/.auth/db-url.txt';

export const E2E_AUTHOR_PASSWORD = 'e2e-secret-password';

/** Fixed UUIDv7 so the reader-view URL is stable across runs. */
export const FIXTURE_REPORT_ID = '0197b300-0000-7000-8000-000000000001';

export const FIXTURE_DOCUMENT = fullDocument;

/**
 * A second seeded report on the DEFAULT theme carrying the Epic 7 correlation
 * blocks: a field-grid header (story 7.3), a comparison-matrix (story 7.2), a
 * source legend (story 7.3) and a set-membership UpSet (story 7.4). Kept separate
 * from the shared full fixture so the axe checks run on the default theme (NFR14)
 * without disturbing the full example's snapshots. Severity and sources scales
 * declared at document level; the matrix and legend reference them by key, and
 * the set-membership block references the matrix by id, so this fixture is the
 * complete correlation report (field grid + matrix + legend + UpSet) rendered end
 * to end.
 */
export const MATRIX_FIXTURE_REPORT_ID = '0197b300-0000-7000-8000-000000000002';

export const MATRIX_FIXTURE_DOCUMENT = {
	version: 1 as const,
	title: 'Coverage Matrix Fixture',
	scales: [
		{
			key: 'severity',
			label: 'Severity',
			kind: 'ordinal' as const,
			entries: [
				{ key: 'critical', label: 'Critical' },
				{ key: 'high', label: 'High' },
				{ key: 'low', label: 'Low' }
			]
		},
		{
			key: 'sources',
			label: 'Sources',
			kind: 'nominal' as const,
			entries: [
				{ key: 'siem', label: 'SIEM' },
				{ key: 'edr', label: 'EDR' },
				{ key: 'review', label: 'Manual review' }
			]
		}
	],
	sections: [
		{
			id: 'overview',
			title: 'Overview',
			blocks: [
				{
					type: 'field-grid' as const,
					id: 'metadata',
					items: [
						{ label: 'Author', value: 'Security team' },
						{ label: 'Date', value: 'Q2 2026' },
						{ label: 'Scope', value: 'Production estate' },
						{ label: 'Status', value: 'Final' }
					]
				}
			]
		},
		{
			id: 'findings',
			title: 'Findings',
			blocks: [
				{
					type: 'comparison-matrix' as const,
					id: 'coverage',
					severityScale: 'severity',
					sourceScale: 'sources',
					findings: [
						{
							category: 'Access control',
							label: 'Weak password policy',
							severity: 'high',
							sources: {
								siem: { state: 'found' as const, text: 'Flagged by the policy rule.' },
								edr: { state: 'missing' as const },
								review: { state: 'none' as const }
							},
							treatment: {
								before: 'No enforced complexity.',
								after: 'Complexity and rotation enforced.',
								status: 'action' as const
							},
							tag: 'pwd'
						},
						{
							category: 'Access control',
							label: 'Stale service accounts',
							severity: 'low',
							sources: {
								review: { state: 'found' as const, text: 'Two accounts identified.' }
							},
							treatment: {
								before: 'Accounts unused for 90 days.',
								after: 'Scheduled for the next cleanup window.',
								status: 'deferred' as const
							}
						},
						{
							category: 'Network',
							label: 'Open management port',
							severity: 'critical',
							sources: {
								siem: { state: 'found' as const },
								edr: { state: 'found' as const, text: 'Confirmed on two hosts.' }
							},
							treatment: {
								before: 'Port reachable from the office VLAN.',
								after: 'Restricted to the jump host.',
								status: 'action' as const
							}
						}
					]
				},
				{
					type: 'legend' as const,
					id: 'source-legend',
					scaleRef: 'sources',
					title: 'Sources'
				},
				{
					type: 'set-membership' as const,
					id: 'coverage-upset',
					sourceBlockId: 'coverage',
					title: 'Coverage by source combination'
				}
			]
		}
	]
};

/**
 * A third seeded report on the DEFAULT theme carrying every Epic 7 Phase B block:
 * the callout (story 7.7, both info and danger tones, with icon + kicker + an
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
export const PHASE_B_FIXTURE_REPORT_ID = '0197b300-0000-7000-8000-000000000003';

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

/** The fixture's section ids, for deep-link assertions. */
export const FIXTURE_SECTION_IDS = [
	'executive-summary',
	'incident-analysis',
	'methodology'
] as const;
