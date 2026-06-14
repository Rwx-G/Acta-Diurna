/**
 * A seeded report on the DEFAULT theme carrying the Epic 7 correlation blocks: a
 * field-grid header (story 7.3), a comparison-matrix (story 7.2), a source legend
 * (story 7.3) and a set-membership UpSet (story 7.4). Kept separate from the
 * shared full fixture so the axe checks run on the default theme (NFR14) without
 * disturbing the full example's snapshots. Severity and sources scales declared at
 * document level; the matrix and legend reference them by key, and the
 * set-membership block references the matrix by id, so this fixture is the
 * complete correlation report (field grid + matrix + legend + UpSet) rendered end
 * to end.
 */
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
