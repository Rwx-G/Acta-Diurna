import { describe, expect, it } from 'vitest';
import { buildChangeSummaryEntries, type SummarySourceDocument } from './change-summary.ts';
import { diffSnapshots, type DiffDocument, type SeriesDiff } from './series-diff.ts';
import type { BindingDelta } from './blocks/shared.ts';

// The builder is fed a SeriesDiff plus the BAKED new snapshot (which carries the 9.4
// KPI deltas). These factories build both views from one literal so the diff verdicts
// and the snapshot's deltas stay in lockstep, mirroring the publish-time pairing.

type Block = { type: string; id: string; [key: string]: unknown };

function textBlock(id: string, text: string): Block {
	return { type: 'text', id, paragraphs: [[{ text }]] };
}

function kpiBlock(id: string, label: string, value: number, delta?: BindingDelta): Block {
	return {
		type: 'kpi',
		id,
		items: [{ label, value }],
		binding: {
			fields: [{ name: 'value', type: 'number' }],
			...(delta !== undefined ? { delta } : {})
		}
	};
}

function section(
	id: string,
	title: string,
	blocks: Block[],
	audiences?: readonly string[]
): DiffDocument['sections'][number] & SummarySourceDocument['sections'][number] {
	return { id, title, ...(audiences !== undefined ? { audiences } : {}), blocks };
}

function doc(sections: ReturnType<typeof section>[]): DiffDocument & SummarySourceDocument {
	return { sections };
}

function upDelta(): BindingDelta {
	return { direction: 'up', priorValue: 100, absolute: 8, relative: 0.08 };
}

describe('buildChangeSummaryEntries', () => {
	it('returns no entries for a no-predecessor diff (first issue)', () => {
		const baked = doc([section('intro', 'Intro', [textBlock('p', 'New.')])]);
		const diff: SeriesDiff = { kind: 'no-predecessor', reason: 'first-issue' };
		expect(buildChangeSummaryEntries(diff, baked)).toEqual([]);
	});

	it('returns no entries for a substantial-drift diff', () => {
		const baked = doc([section('intro', 'Intro', [textBlock('p', 'New.')])]);
		const diff: SeriesDiff = { kind: 'substantial-drift', overlap: 0 };
		expect(buildChangeSummaryEntries(diff, baked)).toEqual([]);
	});

	it('returns no entries when nothing changed between two identical snapshots', () => {
		const snapshot = doc([section('intro', 'Intro', [textBlock('p', 'Same.')])]);
		const diff = diffSnapshots(snapshot, snapshot);
		expect(buildChangeSummaryEntries(diff, snapshot)).toEqual([]);
	});

	it('flags an added section', () => {
		const old = doc([section('intro', 'Intro', [textBlock('p', 'Kept.')])]);
		const baked = doc([
			section('intro', 'Intro', [textBlock('p', 'Kept.')]),
			section('risks', 'Risks', [textBlock('r', 'New risk.')])
		]);
		const diff = diffSnapshots(baked, old);
		const entries = buildChangeSummaryEntries(diff, baked);
		expect(entries).toEqual([{ sectionId: 'risks', sectionTitle: 'Risks', change: 'added' }]);
	});

	it('flags a removed section', () => {
		const old = doc([
			section('intro', 'Intro', [textBlock('p', 'Kept.')]),
			section('risks', 'Risks', [textBlock('r', 'Gone.')])
		]);
		const baked = doc([section('intro', 'Intro', [textBlock('p', 'Kept.')])]);
		const diff = diffSnapshots(baked, old);
		const entries = buildChangeSummaryEntries(diff, baked);
		expect(entries).toContainEqual({
			sectionId: 'risks',
			sectionTitle: 'Risks',
			change: 'removed'
		});
	});

	it('flags a section as updated when its prose changed, without shipping the prose', () => {
		const old = doc([section('intro', 'Intro', [textBlock('p', 'Old prose.')])]);
		const baked = doc([section('intro', 'Intro', [textBlock('p', 'New prose.')])]);
		const diff = diffSnapshots(baked, old);
		const entries = buildChangeSummaryEntries(diff, baked);
		expect(entries).toEqual([{ sectionId: 'intro', sectionTitle: 'Intro', change: 'updated' }]);
		// Leak tripwire: neither the old nor the new prose appears anywhere in the summary.
		const serialized = JSON.stringify(entries);
		expect(serialized).not.toContain('Old prose');
		expect(serialized).not.toContain('New prose');
	});

	it('surfaces a headline movement from a KPI whose data changed, reading the baked delta', () => {
		const old = doc([section('metrics', 'Metrics', [kpiBlock('rev', 'Revenue', 100)])]);
		const baked = doc([
			section('metrics', 'Metrics', [kpiBlock('rev', 'Revenue', 108, upDelta())])
		]);
		const diff = diffSnapshots(baked, old);
		const entries = buildChangeSummaryEntries(diff, baked);
		expect(entries).toEqual([
			{
				sectionId: 'metrics',
				sectionTitle: 'Metrics',
				change: 'updated',
				movements: [{ label: 'Revenue', delta: upDelta() }]
			}
		]);
	});

	it('omits a movement for a KPI whose data changed but carries no baked delta', () => {
		// A KPI whose value moved but with no delta baked (non-numeric, unmatched, or
		// multi-item) contributes no movement - never a fabricated figure.
		const old = doc([section('metrics', 'Metrics', [kpiBlock('rev', 'Revenue', 100)])]);
		const baked = doc([section('metrics', 'Metrics', [kpiBlock('rev', 'Revenue', 108)])]);
		const diff = diffSnapshots(baked, old);
		const entries = buildChangeSummaryEntries(diff, baked);
		expect(entries).toEqual([{ sectionId: 'metrics', sectionTitle: 'Metrics', change: 'updated' }]);
	});

	it('carries the section audience tags so the reader CSS can hide a hidden-level entry', () => {
		const old = doc([section('tech', 'Method', [textBlock('m', 'Old.')], ['technical'])]);
		const baked = doc([section('tech', 'Method', [textBlock('m', 'New.')], ['technical'])]);
		const diff = diffSnapshots(baked, old);
		const entries = buildChangeSummaryEntries(diff, baked);
		expect(entries[0].audiences).toEqual(['technical']);
	});
});
