import { describe, expect, it } from 'vitest';
import { validateDocument } from './errors.ts';
import type { DocumentV1 } from './versions/v1.ts';
import {
	findEntryReferences,
	findScaleReferences,
	renameEntryKey,
	renameScaleKey
} from './scale-cascade.ts';

// A structural working copy touching every scale/entry reference site (legend,
// chip-cluster, comparison-matrix, table, timeline). Minimal per block - the cascade
// only reads/writes the reference fields - and rebuilt fresh per test so a mutation
// in one case never leaks into another. Cast through `unknown` because the blocks omit
// the non-reference fields the full schema requires; the end-to-end validity is proved
// separately below against the real validator with fully-formed blocks.
function baseDoc(): DocumentV1 {
	return {
		version: 1,
		title: 'Audit',
		scales: [
			{
				key: 'severity',
				label: 'Severity',
				kind: 'ordinal',
				entries: [
					{ key: 'critical', label: 'Critical' },
					{ key: 'high', label: 'High' },
					{ key: 'low', label: 'Low' }
				]
			},
			{
				key: 'sources',
				label: 'Sources',
				kind: 'nominal',
				entries: [
					{ key: 'siem', label: 'SIEM' },
					{ key: 'edr', label: 'EDR' }
				]
			}
		],
		sections: [
			{
				id: 'overview',
				title: 'Overview',
				blocks: [
					{
						type: 'comparison-matrix',
						id: 'matrix',
						severityScale: 'severity',
						sourceScale: 'sources',
						findings: [
							{ severity: 'high', sources: { siem: { state: 'found' }, edr: { state: 'missing' } } }
						]
					},
					{ type: 'legend', id: 'legend', scaleRef: 'sources' },
					{
						type: 'chip-cluster',
						id: 'chips',
						scaleRef: 'severity',
						entries: ['critical', 'high']
					},
					{
						type: 'table',
						id: 'table',
						columns: [{ key: 'sev', label: 'Severity', scaleRef: 'severity' }],
						rows: [{ sev: 'high' }, { sev: 'low' }]
					},
					{
						type: 'timeline',
						id: 'timeline',
						milestones: [{ label: 'M1', status: { scaleRef: 'severity', entry: 'high' } }]
					}
				]
			}
		]
	} as unknown as DocumentV1;
}

// Typed accessors for the structural blocks, so the assertions read fields the
// `DocumentV1` block union does not surface structurally.
function blocks(doc: DocumentV1): Record<string, unknown>[] {
	return doc.sections[0].blocks as unknown as Record<string, unknown>[];
}
const matrixOf = (doc: DocumentV1) =>
	blocks(doc)[0] as {
		severityScale: string;
		sourceScale: string;
		findings: { severity: string; sources: Record<string, unknown> }[];
	};
const legendOf = (doc: DocumentV1) => blocks(doc)[1] as { scaleRef: string };
const chipsOf = (doc: DocumentV1) => blocks(doc)[2] as { scaleRef: string; entries: string[] };
const tableOf = (doc: DocumentV1) =>
	blocks(doc)[3] as { columns: { scaleRef: string }[]; rows: Record<string, unknown>[] };
const timelineOf = (doc: DocumentV1) =>
	blocks(doc)[4] as { milestones: { status: { scaleRef: string; entry: string } }[] };

describe('renameScaleKey', () => {
	it('rewrites the scale own key and every scale-key reference site', () => {
		const next = renameScaleKey(baseDoc(), 'severity', 'criticite');

		expect(next.scales?.[0].key).toBe('criticite');
		expect(matrixOf(next).severityScale).toBe('criticite');
		expect(chipsOf(next).scaleRef).toBe('criticite');
		expect(tableOf(next).columns[0].scaleRef).toBe('criticite');
		expect(timelineOf(next).milestones[0].status.scaleRef).toBe('criticite');

		// A reference to a DIFFERENT scale is untouched.
		expect(matrixOf(next).sourceScale).toBe('sources');
		expect(legendOf(next).scaleRef).toBe('sources');
	});

	it('rewrites legend.scaleRef and comparison-matrix.sourceScale for the sources scale', () => {
		const next = renameScaleKey(baseDoc(), 'sources', 'src');
		expect(next.scales?.[1].key).toBe('src');
		expect(legendOf(next).scaleRef).toBe('src');
		expect(matrixOf(next).sourceScale).toBe('src');
		expect(matrixOf(next).severityScale).toBe('severity');
	});

	it('does not mutate the input document', () => {
		const doc = baseDoc();
		renameScaleKey(doc, 'severity', 'criticite');
		expect(doc.scales?.[0].key).toBe('severity');
		expect(matrixOf(doc).severityScale).toBe('severity');
	});

	it('returns the same reference unchanged on a no-op rename', () => {
		const doc = baseDoc();
		expect(renameScaleKey(doc, 'severity', 'severity')).toBe(doc);
	});
});

describe('renameEntryKey', () => {
	it('rewrites the entry own key and every entry reference of that scale', () => {
		const next = renameEntryKey(baseDoc(), 'severity', 'high', 'eleve');

		expect(next.scales?.[0].entries[1].key).toBe('eleve');
		expect(matrixOf(next).findings[0].severity).toBe('eleve');
		expect(chipsOf(next).entries).toEqual(['critical', 'eleve']);
		expect(tableOf(next).rows[0].sev).toBe('eleve');
		expect(timelineOf(next).milestones[0].status.entry).toBe('eleve');

		// A cell holding a different entry is untouched.
		expect(tableOf(next).rows[1].sev).toBe('low');
		// The sources scale's findings.sources keys are untouched (different scale).
		expect(Object.keys(matrixOf(next).findings[0].sources)).toEqual(['siem', 'edr']);
	});

	it('renames a sources entry as a findings.sources object key, preserving order and value', () => {
		const next = renameEntryKey(baseDoc(), 'sources', 'siem', 'splunk');

		expect(next.scales?.[1].entries[0].key).toBe('splunk');
		expect(Object.keys(matrixOf(next).findings[0].sources)).toEqual(['splunk', 'edr']);
		expect(matrixOf(next).findings[0].sources.splunk).toEqual({ state: 'found' });
		// The severity-scale references are untouched (scoped to the sources scale).
		expect(matrixOf(next).findings[0].severity).toBe('high');
		expect(chipsOf(next).entries).toEqual(['critical', 'high']);
	});

	it('is scoped: renaming an entry of a scale a block does not bind leaves the block alone', () => {
		// 'high' is a severity entry; renaming the (non-existent) 'high' entry of the
		// SOURCES scale must not touch the matrix finding severity bound to `severity`.
		const next = renameEntryKey(baseDoc(), 'sources', 'high', 'x');
		expect(matrixOf(next).findings[0].severity).toBe('high');
	});

	it('does not mutate the input document', () => {
		const doc = baseDoc();
		renameEntryKey(doc, 'severity', 'high', 'eleve');
		expect(matrixOf(doc).findings[0].severity).toBe('high');
		expect(chipsOf(doc).entries).toEqual(['critical', 'high']);
	});

	it('returns the same reference unchanged on a no-op rename', () => {
		const doc = baseDoc();
		expect(renameEntryKey(doc, 'severity', 'high', 'high')).toBe(doc);
	});
});

describe('findScaleReferences', () => {
	it('lists every block that binds the scale key', () => {
		const refs = findScaleReferences(baseDoc(), 'severity');
		const vias = refs.map((ref) => `${ref.blockType}:${ref.via}`).sort();
		expect(vias).toEqual([
			'chip-cluster:scaleRef',
			'comparison-matrix:severityScale',
			'table:column 1',
			'timeline:milestone 1'
		]);
	});

	it('lists matrix sourceScale and legend for the sources scale', () => {
		const refs = findScaleReferences(baseDoc(), 'sources');
		const vias = refs.map((ref) => `${ref.blockType}:${ref.via}`).sort();
		expect(vias).toEqual(['comparison-matrix:sourceScale', 'legend:scaleRef']);
	});

	it('returns no references for an unbound scale key', () => {
		expect(findScaleReferences(baseDoc(), 'ghost')).toEqual([]);
	});
});

describe('findEntryReferences', () => {
	it('lists every block using the entry of that scale', () => {
		const refs = findEntryReferences(baseDoc(), 'severity', 'high');
		const vias = refs.map((ref) => `${ref.blockType}:${ref.via}`).sort();
		expect(vias).toEqual([
			'chip-cluster:entry',
			'comparison-matrix:finding 1 severity',
			'table:row 1 column "sev"',
			'timeline:milestone 1'
		]);
	});

	it('lists a sources entry used as a findings.sources key', () => {
		const refs = findEntryReferences(baseDoc(), 'sources', 'siem');
		expect(refs.map((ref) => `${ref.blockType}:${ref.via}`)).toEqual([
			'comparison-matrix:finding 1 source'
		]);
	});

	it('returns no references for an unused entry', () => {
		expect(
			findEntryReferences(baseDoc(), 'severity', 'low').some((r) => r.blockType === 'chip-cluster')
		).toBe(false);
	});
});

// End-to-end: a rename through the cascade keeps the document valid against the real
// cross-reference validator (the strongest guarantee - the renamed document is one the
// server would accept). Uses fully-formed blocks so `validateDocument` exercises the
// complete shape, not just the reference fields.
describe('cascade keeps the document valid (validateDocument round-trip)', () => {
	function validDoc(): unknown {
		return {
			version: 1,
			title: 'Audit',
			scales: [
				{
					key: 'severity',
					label: 'Severity',
					kind: 'ordinal',
					entries: [
						{ key: 'critical', label: 'Critical', color: '#7a2e3a' },
						{ key: 'high', label: 'High' },
						{ key: 'low', label: 'Low' }
					]
				},
				{
					key: 'sources',
					label: 'Sources',
					kind: 'nominal',
					entries: [
						{ key: 'siem', label: 'SIEM' },
						{ key: 'edr', label: 'EDR' }
					]
				}
			],
			sections: [
				{
					id: 'overview',
					title: 'Overview',
					blocks: [
						{
							type: 'comparison-matrix',
							id: 'findings',
							severityScale: 'severity',
							sourceScale: 'sources',
							findings: [
								{
									category: 'Access',
									label: 'Weak policy',
									severity: 'high',
									sources: { siem: { state: 'found' }, edr: { state: 'missing' } },
									treatment: { before: 'a', after: 'b', status: 'action' }
								}
							]
						},
						{ type: 'legend', id: 'source-legend', scaleRef: 'sources' }
					]
				}
			]
		};
	}

	it('a valid document stays valid after a scale-key rename', () => {
		const doc = validDoc();
		expect(validateDocument(doc).ok).toBe(true);
		const renamed = renameScaleKey(doc as DocumentV1, 'severity', 'criticite');
		expect(validateDocument(renamed).ok).toBe(true);
	});

	it('a valid document stays valid after an entry-key rename that cascades into findings', () => {
		const renamed = renameEntryKey(validDoc() as DocumentV1, 'severity', 'high', 'eleve');
		const result = validateDocument(renamed);
		expect(result.ok).toBe(true);
	});

	it('a valid document stays valid after renaming a sources entry used as a findings.sources key', () => {
		const renamed = renameEntryKey(validDoc() as DocumentV1, 'sources', 'siem', 'splunk');
		expect(validateDocument(renamed).ok).toBe(true);
	});
});
