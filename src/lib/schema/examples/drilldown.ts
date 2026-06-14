import type { DocumentV1Input } from '../versions/v1.ts';

/**
 * The in-report drill-down shape (Epic 11), shipped as a published example so an
 * agent authoring over the REST API or MCP discovers it by reading the schema's
 * examples. A tight main narrative (a findings table) links a single finding to a
 * hidden-but-addressable detail page through an internal `linkTo`:
 *
 *  - the `findings` table carries a `rowLinks` array, parallel to its `rows`, that
 *    points the first row at the `finding-detail` section by id;
 *  - that target section is `kind: 'detail'`, so it is reachable ONLY through the
 *    link - kept out of the main slide/scroll sequence and the table of contents,
 *    rendered with its stable anchor id.
 *
 * Every `linkTo` resolves to an existing section id, so the document passes the
 * document-level cross-reference pass (Story 11.2): a dangling target is a
 * validation error, never a reader-time dead click.
 */
export const drilldownDocument: DocumentV1Input = {
	version: 1,
	title: 'Findings With Drill-Down',
	sections: [
		{
			id: 'findings',
			title: 'Findings',
			blocks: [
				{
					type: 'text',
					id: 'intro',
					paragraphs: [
						[
							{ text: 'One finding needs a closer look. ' },
							{ text: 'Open the weak-password detail', linkTo: 'finding-detail' },
							{ text: ' for the full evidence and remediation.' }
						]
					]
				},
				{
					type: 'table',
					id: 'findings-table',
					columns: [
						{ key: 'finding', label: 'Finding' },
						{ key: 'severity', label: 'Severity' }
					],
					rows: [
						{ finding: 'Weak password policy', severity: 'High' },
						{ finding: 'Verbose error pages', severity: 'Low' }
					],
					rowLinks: ['finding-detail', null]
				}
			]
		},
		{
			id: 'finding-detail',
			title: 'Detail: Weak password policy',
			kind: 'detail',
			blocks: [
				{
					type: 'text',
					id: 'evidence',
					paragraphs: [
						[
							{
								text: 'The password policy enforced neither complexity nor rotation, so accounts could keep a four-character password indefinitely. Remediation: require 12+ characters, block known-breached passwords, and rotate on suspected exposure.'
							}
						]
					]
				}
			]
		}
	]
};
