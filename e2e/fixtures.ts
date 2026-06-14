/**
 * Shared constants for the e2e harness: the test author password (its argon2
 * hash is derived at setup time so it stays reproducible across machines/CI),
 * and the seeded fixture report (the schema full example) with a fixed id so
 * the reader-view specs can navigate to a known URL.
 */
import { fullDocument } from '../src/lib/schema/examples/full.ts';

export const E2E_PORT = 4173;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

/**
 * Distinct port for the multi-mode harness so its `node build` server never
 * collides with the single-mode one (the two projects own separate containers and
 * separate app processes - see `multi-global-setup.ts`).
 */
export const E2E_MULTI_PORT = 4273;
export const E2E_MULTI_BASE_URL = `http://localhost:${E2E_MULTI_PORT}`;

/** Where the `setup` project saves the authenticated author storage state. */
export const AUTH_STATE = 'e2e/.auth/author.json';

/**
 * Where globalSetup writes the ephemeral testcontainer DATABASE_URL, for specs
 * that need a direct DB seam (the reader-verification spec). Gitignored with the
 * rest of `.auth/`.
 */
export const DB_URL_FILE = 'e2e/.auth/db-url.txt';

/**
 * The multi-mode harness writes its OWN container DATABASE_URL here, kept separate
 * from the single-mode `DB_URL_FILE` so the two harnesses never read each other's
 * connection string. Gitignored with the rest of `.auth/`.
 */
export const MULTI_DB_URL_FILE = 'e2e/.auth/multi-db-url.txt';

/**
 * The multi-mode harness writes the mapped Mailpit HTTP-API base URL here so a
 * spec can poll the SMTP double without importing the container (the same
 * `.auth`-file seam the DB URL uses). Gitignored with the rest of `.auth/`.
 */
export const MAILPIT_URL_FILE = 'e2e/.auth/mailpit-url.txt';

/**
 * Multi-mode identity env (story 8.1). The harness boots with SMTP set (multi
 * mode), so these MUST satisfy the fail-fast superRefine: `INITIAL_OWNER_EMAIL`
 * sits inside `AUTHOR_EMAIL_DOMAIN`, and `READER_EMAIL_DOMAINS` whitelists a
 * distinct reader domain so the allow-list path (story 8.5) is exercised end to
 * end. These are test-only literals, never production values.
 */
export const E2E_AUTHOR_EMAIL_DOMAIN = 'example.com';
export const E2E_INITIAL_OWNER_EMAIL = 'owner@example.com';
export const E2E_READER_EMAIL_DOMAIN = 'reader.example.com';

/**
 * The multi-mode authors the harness signs in ONCE (in `multi-auth.setup.ts`) and
 * reuses via saved storage state. Collapsing every author sign-in to one per author
 * keeps the run under the per-IP author-verification burst (capacity 5): all
 * requests come from one localhost IP, so re-signing in per test would throttle the
 * later flows. `owner` inherited the seeded report; `alice`/`bob` are minted on
 * their first verified sign-in (the tenancy spec proves they cannot see each other).
 */
export const MULTI_AUTHORS = {
	owner: { email: E2E_INITIAL_OWNER_EMAIL, state: 'e2e/.auth/multi-owner.json' },
	alice: { email: 'alice@example.com', state: 'e2e/.auth/multi-alice.json' },
	bob: { email: 'bob@example.com', state: 'e2e/.auth/multi-bob.json' }
} as const;

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

/**
 * A sixth seeded report on the WARM MERIDIAN theme (Story 6.5, FR39). The shared
 * full fixture already exercises the COOL AURORA theme end to end (its `theme` is
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
export const MERIDIAN_FIXTURE_REPORT_ID = '0197b300-0000-7000-8000-000000000006';

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

/**
 * Fixed ids and literals for the access-audit e2e (Story 6.3, FR24). In SINGLE
 * mode an `/r/<token>` consultation read serves the report DIRECTLY and never
 * calls `recordAccess` (only the MULTI magic-link `completeVerification` writes an
 * access row), so the audit trail cannot be produced through the single-mode HTTP
 * reader flow. The spec therefore seeds the trail through the DB seam (the same
 * `DB_URL_FILE` route `restricted-share.e2e.ts` uses for DB-only state): one
 * share on the full fixture report, one reader identity, and one access record at
 * a fixed UTC instant so the rendered "Opened" cell is byte-stable. Fixed ids let
 * the desktop and mobile project runs share the seeded rows (ON CONFLICT DO
 * NOTHING), and `accessedAt` is fixed so the formatted timestamp is deterministic.
 */
export const AUDIT_SHARE_ID = '0197b300-0000-7000-8000-0000000000a1';
export const AUDIT_READER_IDENTITY_ID = '0197b300-0000-7000-8000-0000000000a2';
export const AUDIT_ACCESS_RECORD_ID = '0197b300-0000-7000-8000-0000000000a3';
export const AUDIT_READER_EMAIL = 'audit-reader@reader.example.com';
export const AUDIT_ACCESSED_AT_ISO = '2026-06-13T14:30:00.000Z';
export const AUDIT_ACCESSED_AT_CELL = '2026-06-13 14:30 UTC';

/**
 * Fixed ids for the retention-purge integration e2e (Story 6.3, FR24/FR38/NFR11).
 * The boot sweep only fires `purgeAccessRecords` when `ACCESS_RECORD_RETENTION_DAYS`
 * is set, and the single-mode harness boots WITHOUT it (the audit trail is kept by
 * default), so the boot sweep cannot be reached in-process. The spec instead drives
 * the REAL `purgeAccessRecords(db, now, retentionDays)` against the live
 * testcontainer Postgres (via DB_URL_FILE), seeding one AGED access record (older
 * than the cutoff) and one FRESH one on a dedicated share + identity, then asserting
 * the DELETE removed only the aged row. This exercises the real end-to-end DELETE
 * the boot sweep would run, just invoked directly rather than through boot env.
 */
export const RETENTION_SHARE_ID = '0197b300-0000-7000-8000-0000000000b1';
export const RETENTION_READER_IDENTITY_ID = '0197b300-0000-7000-8000-0000000000b2';
export const RETENTION_AGED_RECORD_ID = '0197b300-0000-7000-8000-0000000000b3';
export const RETENTION_FRESH_RECORD_ID = '0197b300-0000-7000-8000-0000000000b4';
export const RETENTION_READER_EMAIL = 'retention-reader@reader.example.com';

/** The fixture's section ids, for deep-link assertions. */
export const FIXTURE_SECTION_IDS = [
	'executive-summary',
	'incident-analysis',
	'methodology'
] as const;

/**
 * A fourth seeded report carrying author-only speaker notes (Story 6.2, FR29) for
 * the presenter-view e2e. The shared full fixture has no notes, so the presenter
 * console (current section + speaker notes + next-section preview) and the
 * notes-never-leak privacy guard need a published report that actually carries
 * them. Three regular sections each get a distinct, easily-searched notes string,
 * plus one `annex` section so the meeting-mode toggle (hide annex) has something to
 * drop. Owner-scoped like every fixture (single mode stores ownerId null); the
 * presenter route is owner-scoped and the seeded author owns it. Published so the
 * presenter loads the snapshot and the reader path can serve it via a share.
 */
export const PRESENTER_FIXTURE_REPORT_ID = '0197b300-0000-7000-8000-000000000004';

/** The speaker-notes strings, asserted present in the presenter and absent from the reader. */
export const PRESENTER_NOTES = {
	intro: 'PRESENTER-NOTE-INTRO open with the headline incident count.',
	findings: 'PRESENTER-NOTE-FINDINGS walk the table top to bottom, pause on critical.',
	annex: 'PRESENTER-NOTE-ANNEX only if asked about methodology.'
} as const;

export const PRESENTER_FIXTURE_DOCUMENT = {
	version: 1 as const,
	title: 'Briefing With Speaker Notes',
	sections: [
		{
			id: 'intro',
			title: 'Introduction',
			notes: PRESENTER_NOTES.intro,
			blocks: [
				{
					type: 'text' as const,
					id: 'intro-text',
					paragraphs: [[{ text: 'Quarter overview and headline figures.' }]]
				}
			]
		},
		{
			id: 'findings',
			title: 'Findings',
			notes: PRESENTER_NOTES.findings,
			blocks: [
				{
					type: 'text' as const,
					id: 'findings-text',
					paragraphs: [[{ text: 'Three findings, one critical, all remediated.' }]]
				}
			]
		},
		{
			id: 'methodology',
			title: 'Methodology',
			annex: true,
			notes: PRESENTER_NOTES.annex,
			blocks: [
				{
					type: 'text' as const,
					id: 'methodology-text',
					paragraphs: [[{ text: 'Counts sourced from the SIEM export.' }]]
				}
			]
		}
	]
};

/**
 * A fifth seeded report for the data-as-of caption e2e (Story 6.4, FR16). The
 * `binding.dataAsOf` stamp is baked onto the document server-side at bind/rebind
 * time, so the caption reads straight off the validated document - seeding it
 * directly is the deterministic, minimal route (no upload/inject round-trip). The
 * table block carries an explicit `dataAsOf` (a fixed UTC instant, so the formatted
 * "Data as of 15 Mar 2026" caption is byte-stable regardless of machine locale or
 * clock); the kpi block is bound but carries NO `dataAsOf`, so its block renders no
 * caption at all (omitted, never a placeholder). Published so the seeded author can
 * open it; rendered via the author `/view`.
 */
export const DATA_AS_OF_FIXTURE_REPORT_ID = '0197b300-0000-7000-8000-000000000005';

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
