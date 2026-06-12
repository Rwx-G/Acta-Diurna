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
 * A second seeded report on the DEFAULT theme carrying a comparison-matrix block
 * (Epic 7, story 7.2). Kept separate from the shared full fixture so the matrix
 * axe check runs on the default theme (NFR14) without disturbing the full
 * example's snapshots. Severity and sources scales declared at document level;
 * the block references them by key.
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
