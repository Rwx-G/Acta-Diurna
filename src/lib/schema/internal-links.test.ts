import { describe, expect, it } from 'vitest';
import { validateDocument } from './errors.ts';
import { validateInternalLinks } from './internal-links.ts';

const scales = [
	{ key: 'severity', label: 'Severity', entries: [{ key: 'high', label: 'High' }] },
	{ key: 'sources', label: 'Sources', entries: [{ key: 'siem', label: 'SIEM' }] }
];

function matrixBlock(linkTo?: string) {
	return {
		type: 'comparison-matrix',
		id: 'matrix',
		severityScale: 'severity',
		sourceScale: 'sources',
		findings: [
			{
				category: 'Access',
				label: 'Weak policy',
				severity: 'high',
				sources: { siem: { state: 'found' } },
				treatment: { before: 'a', after: 'b', status: 'action' },
				...(linkTo === undefined ? {} : { linkTo })
			}
		]
	};
}

function doc(blocks: unknown[], extraSections: unknown[] = []) {
	return {
		version: 1 as const,
		title: 'Drill-down',
		scales,
		sections: [{ id: 'overview', title: 'Overview', blocks }, ...extraSections]
	};
}

function detailSection(id = 'finding-detail') {
	return {
		id,
		title: 'Detail',
		kind: 'detail' as const,
		blocks: [{ type: 'text', id: 'evidence', paragraphs: [[{ text: 'Evidence.' }]] }]
	};
}

describe('validateInternalLinks seam', () => {
	it('returns no issues for a document with no linkTo anywhere', () => {
		const issues = validateInternalLinks({
			sections: [{ id: 'overview', blocks: [{ type: 'text' }] }]
		});
		expect(issues).toEqual([]);
	});
});

describe('validateInternalLinks - dangling targets fail validation (FR2 parity)', () => {
	it('flags a dangling inline-run linkTo, naming the run and the missing id', () => {
		const result = validateDocument(
			doc([
				{
					type: 'text',
					id: 'intro',
					paragraphs: [[{ text: 'See ' }, { text: 'detail', linkTo: 'ghost-section' }]]
				}
			])
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const issue = result.errors.find((e) => e.message.includes('ghost-section'));
			expect(issue?.path).toBe('sections[0].blocks[0].paragraphs[0][1].linkTo');
			expect(issue?.message).toContain('inline run');
			expect(issue?.message).toContain('ghost-section');
			expect(issue?.hint).toBeTruthy();
		}
	});

	it('flags a dangling table rowLinks entry, naming the row and the missing id', () => {
		const result = validateDocument(
			doc([
				{
					type: 'table',
					id: 'rows',
					columns: [{ key: 'name', label: 'Name' }],
					rows: [{ name: 'A' }, { name: 'B' }],
					rowLinks: [null, 'ghost-section']
				}
			])
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const issue = result.errors.find((e) => e.message.includes('ghost-section'));
			expect(issue?.path).toBe('sections[0].blocks[0].rowLinks[1]');
			expect(issue?.message).toContain('table row 2');
			expect(issue?.message).toContain('ghost-section');
		}
	});

	it('flags a dangling matrix-finding linkTo, naming the finding and the missing id', () => {
		const result = validateDocument(doc([matrixBlock('ghost-section')]));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const issue = result.errors.find((e) => e.message.includes('ghost-section'));
			expect(issue?.path).toBe('sections[0].blocks[0].findings[0].linkTo');
			expect(issue?.message).toContain('finding 1');
			expect(issue?.message).toContain('ghost-section');
		}
	});

	it('flags a dangling run linkTo inside a callout / list / timeline rich-text body', () => {
		const result = validateDocument(
			doc([
				{
					type: 'callout',
					id: 'note',
					tone: 'info',
					body: [[{ text: 'see', linkTo: 'ghost-section' }]]
				}
			])
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.some((e) => e.message.includes('ghost-section'))).toBe(true);
		}
	});
});

describe('validateInternalLinks - valid targets pass', () => {
	it('passes a linkTo that resolves to a detail section', () => {
		const result = validateDocument(
			doc(
				[
					{
						type: 'text',
						id: 'intro',
						paragraphs: [[{ text: 'detail', linkTo: 'finding-detail' }]]
					}
				],
				[detailSection()]
			)
		);
		expect(result.ok).toBe(true);
	});

	it('passes a linkTo that resolves to a main-flow section (existing fragment deep-link)', () => {
		// Linking the flow to a flow section is the existing fragment deep-link and
		// stays allowed; the hard rule is only that the target exists.
		const result = validateDocument(
			doc(
				[
					{
						type: 'text',
						id: 'intro',
						paragraphs: [[{ text: 'top', linkTo: 'appendix' }]]
					}
				],
				[
					{
						id: 'appendix',
						title: 'Appendix',
						blocks: [{ type: 'text', id: 'a', paragraphs: [[{ text: 'A.' }]] }]
					}
				]
			)
		);
		expect(result.ok).toBe(true);
	});

	it('passes every carrier pointing at an existing section', () => {
		const result = validateDocument(
			doc(
				[
					{
						type: 'text',
						id: 'intro',
						paragraphs: [[{ text: 'r', linkTo: 'finding-detail' }]]
					},
					{
						type: 'table',
						id: 'rows',
						columns: [{ key: 'name', label: 'Name' }],
						rows: [{ name: 'A' }],
						rowLinks: ['finding-detail']
					},
					matrixBlock('finding-detail')
				],
				[detailSection()]
			)
		);
		expect(result.ok).toBe(true);
		const issues = validateInternalLinks({
			sections: [
				{
					id: 'overview',
					blocks: [
						{ type: 'text', paragraphs: [[{ linkTo: 'finding-detail' }]] },
						{ type: 'table', rowLinks: ['finding-detail'] },
						{ type: 'comparison-matrix', findings: [{ linkTo: 'finding-detail' }] }
					]
				},
				{ id: 'finding-detail', blocks: [] }
			]
		});
		expect(issues).toEqual([]);
	});
});
