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

function kpiBlock(
	id: string,
	label: string | undefined,
	value: number,
	delta?: BindingDelta,
	audiences?: readonly string[]
): Block {
	return {
		type: 'kpi',
		id,
		...(audiences !== undefined ? { audiences } : {}),
		items: [{ ...(label !== undefined ? { label } : {}), value }],
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

	it('carries the block audience tags on a movement so a hidden-level KPI movement is hidden too', () => {
		// A section visible at every level (untagged) containing a KPI tagged `technical`:
		// the report body hides that KPI at `summary` via `data-level`, so the movement must
		// inherit the BLOCK's tags - otherwise the summary surfaces a figure the body
		// conceals at `summary`. The movement carries the block's tags so the SAME CSS hides
		// it: hidden at `summary`, shown at `technical`.
		const old = doc([
			section('metrics', 'Metrics', [kpiBlock('rev', 'Revenue', 100, undefined, ['technical'])])
		]);
		const baked = doc([
			section('metrics', 'Metrics', [kpiBlock('rev', 'Revenue', 108, upDelta(), ['technical'])])
		]);
		const diff = diffSnapshots(baked, old);
		const entries = buildChangeSummaryEntries(diff, baked);
		expect(entries[0].movements).toEqual([
			{ label: 'Revenue', delta: upDelta(), audiences: ['technical'] }
		]);
	});

	it('intersects the section and block audience tags on a movement (EITHER-hidden rule)', () => {
		// Section visible at summary+full, KPI tagged full+technical: the movement is shown
		// only where BOTH show it (the intersection `full`), so it is hidden at summary (the
		// section hides it there) and at technical (the block hides it there).
		const old = doc([
			section(
				'metrics',
				'Metrics',
				[kpiBlock('rev', 'Revenue', 100, undefined, ['full', 'technical'])],
				['summary', 'full']
			)
		]);
		const baked = doc([
			section(
				'metrics',
				'Metrics',
				[kpiBlock('rev', 'Revenue', 108, upDelta(), ['full', 'technical'])],
				['summary', 'full']
			)
		]);
		const diff = diffSnapshots(baked, old);
		const entries = buildChangeSummaryEntries(diff, baked);
		expect(entries[0].movements?.[0].audiences).toEqual(['full']);
	});

	it('omits a movement when the section and block audience tags are disjoint (hidden everywhere)', () => {
		// Section visible only at `summary`, KPI tagged only `technical`: the intersection is
		// empty, so the movement is hidden at EVERY level. Baking it with an empty `audiences`
		// would serialize to no `data-audiences` attribute -> visible everywhere (a leak), so
		// it is omitted entirely. The section is still flagged `updated`, just with no movement.
		const old = doc([
			section(
				'metrics',
				'Metrics',
				[kpiBlock('rev', 'Revenue', 100, undefined, ['technical'])],
				['summary']
			)
		]);
		const baked = doc([
			section(
				'metrics',
				'Metrics',
				[kpiBlock('rev', 'Revenue', 108, upDelta(), ['technical'])],
				['summary']
			)
		]);
		const diff = diffSnapshots(baked, old);
		const entries = buildChangeSummaryEntries(diff, baked);
		expect(entries).toEqual([
			{ sectionId: 'metrics', sectionTitle: 'Metrics', change: 'updated', audiences: ['summary'] }
		]);
		expect(entries[0].movements).toBeUndefined();
	});

	it('still surfaces a movement when both the section and block are untagged (shown everywhere)', () => {
		// No constraint on either side: the movement carries no `audiences` and shows at
		// every level, like its block. This is the absent-constraint case the omit guard
		// must NOT trip on.
		const old = doc([section('metrics', 'Metrics', [kpiBlock('rev', 'Revenue', 100)])]);
		const baked = doc([
			section('metrics', 'Metrics', [kpiBlock('rev', 'Revenue', 108, upDelta())])
		]);
		const diff = diffSnapshots(baked, old);
		const entries = buildChangeSummaryEntries(diff, baked);
		expect(entries[0].movements).toEqual([{ label: 'Revenue', delta: upDelta() }]);
	});

	it('carries the predecessor audience tags on a removed section (not the absent new-snapshot tags)', () => {
		// A technical-only section deleted this issue is GONE from the baked snapshot, so its
		// tags can only come from the predecessor. Without threading them, the entry would
		// carry no tags and surface the deleted section's title at `summary` - a leak.
		const old = doc([
			section('intro', 'Intro', [textBlock('p', 'Kept.')]),
			section('method', 'Method', [textBlock('m', 'Gone.')], ['technical'])
		]);
		const baked = doc([section('intro', 'Intro', [textBlock('p', 'Kept.')])]);
		const diff = diffSnapshots(baked, old);
		const entries = buildChangeSummaryEntries(diff, baked, old);
		const removed = entries.find((entry) => entry.sectionId === 'method');
		expect(removed).toEqual({
			sectionId: 'method',
			sectionTitle: 'Method',
			change: 'removed',
			audiences: ['technical']
		});
	});

	it('omits a movement whose KPI has no usable label (omit-rather-than-mislead)', () => {
		// An unlabeled KPI must not borrow the section title - that would attribute the
		// figure to the wrong subject. The movement is omitted entirely, the same posture as
		// a KPI with no baked delta.
		const old = doc([section('metrics', 'Metrics', [kpiBlock('rev', undefined, 100)])]);
		const baked = doc([
			section('metrics', 'Metrics', [kpiBlock('rev', undefined, 108, upDelta())])
		]);
		const diff = diffSnapshots(baked, old);
		const entries = buildChangeSummaryEntries(diff, baked);
		expect(entries).toEqual([{ sectionId: 'metrics', sectionTitle: 'Metrics', change: 'updated' }]);
	});

	it('emits no movements for an added section (its blocks are all added, no prior to compare)', () => {
		const old = doc([section('intro', 'Intro', [textBlock('p', 'Kept.')])]);
		const baked = doc([
			section('intro', 'Intro', [textBlock('p', 'Kept.')]),
			section('metrics', 'Metrics', [kpiBlock('rev', 'Revenue', 108, upDelta())])
		]);
		const diff = diffSnapshots(baked, old);
		const entries = buildChangeSummaryEntries(diff, baked);
		expect(entries).toContainEqual({
			sectionId: 'metrics',
			sectionTitle: 'Metrics',
			change: 'added'
		});
		const added = entries.find((entry) => entry.sectionId === 'metrics');
		expect(added?.movements).toBeUndefined();
	});
});
