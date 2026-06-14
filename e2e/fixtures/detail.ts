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
 * The first two detail sections are untagged (no `audiences`), so they appear at
 * every level. Story 11.4 adds two AUDIENCE-TAGGED detail pages to harden the
 * audience/deep-link edges: `detail-technical-only` is a section-level
 * `['technical']` page (the whole detail host is hidden by the audience CSS until
 * the level is promoted), and `detail-mixed-levels` is an untagged section whose
 * only body block is `['technical']`-tagged (the host shows but its content is an
 * empty box until promotion). Both are reachable through an inline `linkTo` from
 * the summary prose, and a deep link / click promotion must land on their content.
 *
 * Audience tags are a reading-comfort filter, not a confidentiality boundary
 * (Epic 6 invariant): every level still SSR-renders into the reader's DOM.
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
			// A dedicated flow section for the audience-tagged drill-down links (Story
			// 11.4). Kept separate from `summary` and `findings` so those sections stay
			// byte-stable for the 11.3 navigation geometry; this one carries the inline
			// links into the two audience-tagged detail pages.
			id: 'drilldowns',
			title: 'Deeper reading',
			blocks: [
				{
					type: 'text' as const,
					id: 'audience-drilldowns',
					paragraphs: [
						[
							{ text: 'A ' },
							{
								text: 'technical-only deep dive',
								linkTo: 'detail-technical-only'
							},
							{ text: ' and a ' },
							{
								text: 'mixed-level appendix',
								linkTo: 'detail-mixed-levels'
							},
							{ text: ' carry audience tags for readers who want the depth.' }
						]
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
		},
		{
			// Section-level audience tag (Story 11.4): the whole detail host is
			// `data-audiences="technical"`, so at the default `full` level the audience
			// CSS hides it even when `:target` is set. A deep link or a click must
			// promote the level to `technical` before navigating, or it lands on an
			// empty hidden box.
			id: 'detail-technical-only',
			title: 'Detail: Technical deep dive',
			kind: 'detail' as const,
			audiences: ['technical'] as const,
			blocks: [
				{
					type: 'text' as const,
					id: 'technical-only-body',
					paragraphs: [
						[
							{
								text: 'Packet captures showed the management service answering unauthenticated probes from the office VLAN subnet.'
							}
						]
					]
				}
			]
		},
		{
			// Block-level audience tag (Story 11.4): the section itself is untagged (so
			// it is visible at every level), but its only body block is
			// `data-audiences="technical"`. At `full` the host shows but its content is
			// hidden - an empty box. Promotion must raise the level to reveal the block,
			// not merely the host.
			id: 'detail-mixed-levels',
			title: 'Detail: Mixed-level appendix',
			kind: 'detail' as const,
			blocks: [
				{
					type: 'text' as const,
					id: 'mixed-technical-body',
					audiences: ['technical'] as const,
					paragraphs: [
						[
							{
								text: 'The remediation rewrote the firewall policy to default-deny inbound on the management interface.'
							}
						]
					]
				}
			]
		}
	]
};
