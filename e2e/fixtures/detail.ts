/**
 * A seeded report exercising the Epic 11 in-report drill-down (story 11.3): a
 * main-flow narrative with two hidden-but-addressable detail pages, each reached
 * ONLY through an internal `linkTo` - one from a table row (`rowLinks`), one from
 * a comparison-matrix finding, one from an inline run in prose. The detail
 * sections carry `kind: 'detail'`, so they are excluded from the main slide/scroll
 * sequence and the TOC while still rendering with their stable anchor ids. Kept
 * separate from the shared full fixture so its snapshots stay intact; the reader
 * navigation specs (`reader-detail-navigation.e2e.ts`) drive this report.
 *
 * The detail sections are untagged (no `audiences`), so audience-level promotion
 * is out of scope here - that interaction is hardened in story 11.4.
 */
export const DETAIL_FIXTURE_DOCUMENT = {
	version: 1 as const,
	title: 'Drill-Down Findings Report',
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
				{ key: 'edr', label: 'EDR' }
			]
		}
	],
	sections: [
		{
			id: 'summary',
			title: 'Summary',
			blocks: [
				{
					type: 'text' as const,
					id: 'intro',
					paragraphs: [
						[
							{ text: 'Two findings stood out this quarter. ' },
							{
								text: 'Read the weak-password detail',
								linkTo: 'detail-weak-password'
							},
							{ text: ' for the full evidence and remediation steps.' }
						]
					]
				}
			]
		},
		{
			id: 'findings',
			title: 'Findings',
			blocks: [
				{
					type: 'table' as const,
					id: 'findings-table',
					columns: [
						{ key: 'finding', label: 'Finding' },
						{ key: 'severity', label: 'Severity' }
					],
					rows: [
						{ finding: 'Weak password policy', severity: 'High' },
						{ finding: 'Open management port', severity: 'Critical' }
					],
					rowLinks: ['detail-weak-password', 'detail-open-port']
				},
				{
					type: 'comparison-matrix' as const,
					id: 'coverage',
					severityScale: 'severity',
					sourceScale: 'sources',
					findings: [
						{
							category: 'Network',
							label: 'Open management port',
							severity: 'critical' as const,
							sources: {
								siem: { state: 'found' as const },
								edr: { state: 'found' as const, text: 'Confirmed on two hosts.' }
							},
							treatment: {
								before: 'Port reachable from the office VLAN.',
								after: 'Restricted to the jump host.',
								status: 'action' as const
							},
							linkTo: 'detail-open-port'
						}
					]
				}
			]
		},
		{
			id: 'detail-weak-password',
			title: 'Detail: Weak password policy',
			kind: 'detail' as const,
			blocks: [
				{
					type: 'text' as const,
					id: 'weak-password-body',
					paragraphs: [
						[
							{
								text: 'The password policy did not enforce complexity or rotation. Accounts could keep a four-character password indefinitely.'
							}
						]
					]
				}
			]
		},
		{
			id: 'detail-open-port',
			title: 'Detail: Open management port',
			kind: 'detail' as const,
			blocks: [
				{
					type: 'text' as const,
					id: 'open-port-body',
					paragraphs: [
						[
							{
								text: 'The management port was reachable from the office VLAN. It is now restricted to the jump host.'
							}
						]
					]
				}
			]
		}
	]
};
