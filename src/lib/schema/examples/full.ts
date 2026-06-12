import type { DocumentV1Input } from '../versions/v1.ts';

/**
 * Exercises every schema v1 feature: the five block types, audience tags on
 * sections and blocks, an annex section, static data, data bindings (with and
 * without `dataSetId`), a block carrying both static data and a binding, and
 * document-level categorical scales (Epic 7): a severity scale (ordinal, mixed
 * explicit/default colours) and a sources scale (nominal, all default colours).
 */
export const fullDocument: DocumentV1Input = {
	version: 1,
	title: 'Quarterly Security Report',
	theme: 'aurora',
	scales: [
		{
			key: 'severity',
			label: 'Severity',
			kind: 'ordinal',
			entries: [
				{ key: 'critical', label: 'Critical', color: '#7a2e3a', sublabel: 'Act immediately' },
				{ key: 'high', label: 'High', color: '#8a5a13' },
				{ key: 'medium', label: 'Medium' },
				{ key: 'low', label: 'Low' }
			]
		},
		{
			key: 'sources',
			label: 'Detection sources',
			kind: 'nominal',
			entries: [
				{ key: 'siem', label: 'SIEM' },
				{ key: 'edr', label: 'EDR' },
				{ key: 'analyst', label: 'Analyst review' }
			]
		}
	],
	sections: [
		{
			id: 'executive-summary',
			title: 'Executive Summary',
			audiences: ['summary', 'full'],
			blocks: [
				{
					type: 'kpi',
					id: 'headline-indicators',
					audiences: ['summary'],
					items: [
						{ label: 'Incidents resolved', value: 42, trend: 'up' },
						{ label: 'Mean time to resolve', value: 3.2, unit: 'h', trend: 'down' },
						{ label: 'Open findings', value: 7, trend: 'flat' }
					]
				},
				{
					type: 'text',
					id: 'summary-narrative',
					paragraphs: [
						[
							{ text: 'Incident volume dropped ' },
							{ text: '18%', bold: true },
							{ text: ' quarter over quarter. Details in the ' },
							{
								text: 'full methodology',
								italic: true,
								link: { href: 'https://example.com/methodology' }
							},
							{ text: '.' }
						],
						[{ text: 'No critical findings remain open.' }]
					]
				}
			]
		},
		{
			id: 'incident-analysis',
			title: 'Incident Analysis',
			audiences: ['full', 'technical'],
			blocks: [
				{
					type: 'chart',
					id: 'incidents-by-week',
					kind: 'line',
					series: [
						{
							name: 'Incidents',
							points: [
								{ x: 'W1', y: 14 },
								{ x: 'W2', y: 11 },
								{ x: 'W3', y: 9 },
								{ x: 'W4', y: 8 }
							]
						}
					],
					xAxisLabel: 'Week',
					yAxisLabel: 'Incidents',
					legendLabel: 'Q2 incident volume',
					binding: {
						dataSetId: 'incident-export-q2',
						fields: [
							{ name: 'week', type: 'date' },
							{ name: 'incidents', type: 'number' }
						]
					}
				},
				{
					type: 'table',
					id: 'severity-breakdown',
					audiences: ['technical'],
					columns: [
						{ key: 'severity', label: 'Severity' },
						{ key: 'count', label: 'Count' },
						{ key: 'resolved', label: 'Resolved' }
					],
					rows: [
						{ severity: 'critical', count: 2, resolved: true },
						{ severity: 'high', count: 11, resolved: true },
						{ severity: 'medium', count: 29, resolved: false }
					],
					options: { stickyHeader: true }
				},
				{
					type: 'image',
					id: 'attack-path-diagram',
					assetId: '0197b3a0-5c6e-7c2a-9f4d-2b8e6a1d3c5f',
					alt: 'Attack path diagram showing lateral movement from the DMZ to the database tier',
					caption: 'Reconstructed attack path for incident 2026-117'
				}
			]
		},
		{
			id: 'methodology',
			title: 'Methodology',
			audiences: ['technical'],
			annex: true,
			blocks: [
				{
					type: 'kpi',
					id: 'data-coverage',
					binding: {
						fields: [
							{ name: 'label', type: 'string' },
							{ name: 'value', type: 'number' }
						]
					}
				},
				{
					type: 'text',
					id: 'methodology-notes',
					paragraphs: [[{ text: 'Counts are sourced from the SIEM export; weeks are ISO weeks.' }]]
				}
			]
		}
	]
};
