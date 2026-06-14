import { describe, expect, it } from 'vitest';
import {
	diffSnapshots,
	SUBSTANTIAL_DRIFT_THRESHOLD,
	type ComputedDiff,
	type DiffDocument,
	type SeriesDiff
} from './series-diff.ts';

/** A block carries an id and type plus arbitrary content/data fields - the snapshot shape the engine reads. */
type Block = { type: string; id: string; [key: string]: unknown };

/** A text block with one paragraph of the given text (the CONTENT surface). */
function textBlock(id: string, text: string): Block {
	return { type: 'text', id, paragraphs: [[{ text }]] };
}

/** A table block carrying static rows (the DATA surface) and a column label (CONTENT). */
function tableBlock(
	id: string,
	rows: Array<Record<string, unknown>>,
	columnLabel = 'Metric'
): Block {
	return {
		type: 'table',
		id,
		columns: [{ key: 'metric', label: columnLabel }],
		rows
	};
}

/** A kpi block with one item (its `items` are DATA, never re-classified as content). */
function kpiBlock(id: string, value: number): Block {
	return { type: 'kpi', id, items: [{ label: 'Revenue', value }] };
}

function section(id: string, title: string, blocks: Block[]): DiffDocument['sections'][number] {
	return { id, title, blocks };
}

function doc(sections: DiffDocument['sections']): DiffDocument {
	return { sections };
}

/** Narrows a computed diff or fails the test loudly if the verdict is neutral. */
function asDiff(result: SeriesDiff): ComputedDiff {
	expect(result.kind).toBe('diff');
	return result as ComputedDiff;
}

/** Finds one block diff by id across all sections of a computed diff. */
function blockById(result: ComputedDiff, id: string) {
	const found = result.sections.flatMap((s) => s.blocks).find((b) => b.id === id);
	if (found === undefined) throw new Error(`no block diff for id "${id}"`);
	return found;
}

describe('diffSnapshots', () => {
	describe('no predecessor', () => {
		it('returns a neutral no-predecessor result when the old snapshot is null', () => {
			const result = diffSnapshots(doc([section('s1', 'Intro', [textBlock('b1', 'Hello')])]), null);
			expect(result).toEqual({ kind: 'no-predecessor' });
		});
	});

	describe('identical snapshots', () => {
		it('returns a diff with every block kept and nothing changed', () => {
			const snapshot = doc([
				section('s1', 'Intro', [textBlock('b1', 'Hello'), tableBlock('b2', [{ metric: 10 }])])
			]);
			// Two independent copies so the engine cannot rely on reference identity.
			const result = asDiff(diffSnapshots(snapshot, structuredClone(snapshot)));

			expect(result.sections).toHaveLength(1);
			expect(result.sections[0].change).toBe('kept');
			for (const block of result.sections[0].blocks) {
				expect(block.change).toBe('kept');
				expect(block.dataChanged).toBe(false);
				expect(block.contentChanged).toBe(false);
			}
		});
	});

	describe('structural diff by id', () => {
		it('flags a block present only in the new snapshot as added', () => {
			const oldDoc = doc([section('s1', 'Intro', [textBlock('b1', 'Hello')])]);
			const newDoc = doc([
				section('s1', 'Intro', [textBlock('b1', 'Hello'), textBlock('b2', 'New paragraph')])
			]);

			const result = asDiff(diffSnapshots(newDoc, oldDoc));

			expect(blockById(result, 'b2').change).toBe('added');
			expect(blockById(result, 'b1').change).toBe('kept');
		});

		it('flags a block present only in the old snapshot as removed', () => {
			const oldDoc = doc([
				section('s1', 'Intro', [textBlock('b1', 'Hello'), textBlock('b2', 'Going away')])
			]);
			const newDoc = doc([section('s1', 'Intro', [textBlock('b1', 'Hello')])]);

			const result = asDiff(diffSnapshots(newDoc, oldDoc));

			expect(blockById(result, 'b2').change).toBe('removed');
		});

		it('flags a block whose position changed within its section as moved', () => {
			const oldDoc = doc([
				section('s1', 'Intro', [textBlock('b1', 'First'), textBlock('b2', 'Second')])
			]);
			const newDoc = doc([
				section('s1', 'Intro', [textBlock('b2', 'Second'), textBlock('b1', 'First')])
			]);

			const result = asDiff(diffSnapshots(newDoc, oldDoc));

			expect(blockById(result, 'b1').change).toBe('moved');
			expect(blockById(result, 'b2').change).toBe('moved');
		});

		it('flags a block whose parent section changed as moved, not removed+added', () => {
			const oldDoc = doc([
				section('s1', 'Intro', [textBlock('b1', 'Wandering')]),
				section('s2', 'Body', [textBlock('b2', 'Anchor')])
			]);
			const newDoc = doc([
				section('s1', 'Intro', [textBlock('b3', 'Replacement anchor')]),
				section('s2', 'Body', [textBlock('b2', 'Anchor'), textBlock('b1', 'Wandering')])
			]);

			const result = asDiff(diffSnapshots(newDoc, oldDoc));

			// b1 moved sections: reported once, under its new section, as moved.
			const movedOccurrences = result.sections
				.flatMap((s) => s.blocks)
				.filter((b) => b.id === 'b1');
			expect(movedOccurrences).toHaveLength(1);
			expect(movedOccurrences[0].change).toBe('moved');
		});

		it('reads a rebuilt block (new id) as a clean add/remove pair, never a rename', () => {
			const oldDoc = doc([
				section('s1', 'Intro', [textBlock('b1', 'Old prose'), textBlock('keep', 'k')])
			]);
			const newDoc = doc([
				section('s1', 'Intro', [textBlock('b2', 'New prose'), textBlock('keep', 'k')])
			]);

			const result = asDiff(diffSnapshots(newDoc, oldDoc));

			expect(blockById(result, 'b1').change).toBe('removed');
			expect(blockById(result, 'b2').change).toBe('added');
		});

		it('flags an added section and a removed section by id', () => {
			const oldDoc = doc([
				section('s1', 'Intro', [textBlock('b1', 'a')]),
				section('s2', 'Gone', [textBlock('b2', 'b')])
			]);
			const newDoc = doc([
				section('s1', 'Intro', [textBlock('b1', 'a')]),
				section('s3', 'Fresh', [textBlock('b3', 'c')])
			]);

			const result = asDiff(diffSnapshots(newDoc, oldDoc));
			const byId = new Map(result.sections.map((s) => [s.id, s.change]));

			expect(byId.get('s1')).toBe('kept');
			expect(byId.get('s3')).toBe('added');
			expect(byId.get('s2')).toBe('removed');
		});

		it('flags a reordered section as moved', () => {
			const oldDoc = doc([
				section('s1', 'One', [textBlock('b1', 'a')]),
				section('s2', 'Two', [textBlock('b2', 'b')])
			]);
			const newDoc = doc([
				section('s2', 'Two', [textBlock('b2', 'b')]),
				section('s1', 'One', [textBlock('b1', 'a')])
			]);

			const result = asDiff(diffSnapshots(newDoc, oldDoc));
			const byId = new Map(result.sections.map((s) => [s.id, s.change]));

			expect(byId.get('s1')).toBe('moved');
			expect(byId.get('s2')).toBe('moved');
		});
	});

	describe('data diff on bound blocks', () => {
		it('flags a table whose rows changed as a data change, not a content change', () => {
			const oldDoc = doc([section('s1', 'Metrics', [tableBlock('t1', [{ metric: 10 }])])]);
			const newDoc = doc([section('s1', 'Metrics', [tableBlock('t1', [{ metric: 20 }])])]);

			const block = blockById(asDiff(diffSnapshots(newDoc, oldDoc)), 't1');

			expect(block.change).toBe('kept');
			expect(block.dataChanged).toBe(true);
			expect(block.contentChanged).toBe(false);
		});

		it('flags a kpi whose value changed as a data change', () => {
			const oldDoc = doc([section('s1', 'KPIs', [kpiBlock('k1', 100)])]);
			const newDoc = doc([section('s1', 'KPIs', [kpiBlock('k1', 120)])]);

			const block = blockById(asDiff(diffSnapshots(newDoc, oldDoc)), 'k1');

			expect(block.dataChanged).toBe(true);
			expect(block.contentChanged).toBe(false);
		});

		it('separates a column-label edit (content) from the rows (data) on the same table', () => {
			const oldDoc = doc([
				section('s1', 'Metrics', [tableBlock('t1', [{ metric: 10 }], 'Old label')])
			]);
			const newDoc = doc([
				section('s1', 'Metrics', [tableBlock('t1', [{ metric: 10 }], 'New label')])
			]);

			const block = blockById(asDiff(diffSnapshots(newDoc, oldDoc)), 't1');

			expect(block.dataChanged).toBe(false);
			expect(block.contentChanged).toBe(true);
		});

		it('flags both dimensions when a bound block changed in data AND content', () => {
			const oldDoc = doc([
				section('s1', 'Metrics', [tableBlock('t1', [{ metric: 10 }], 'Old label')])
			]);
			const newDoc = doc([
				section('s1', 'Metrics', [tableBlock('t1', [{ metric: 99 }], 'New label')])
			]);

			const block = blockById(asDiff(diffSnapshots(newDoc, oldDoc)), 't1');

			expect(block.dataChanged).toBe(true);
			expect(block.contentChanged).toBe(true);
		});

		it('reports moved AND data-changed together (every applicable verdict, not just the first)', () => {
			const oldDoc = doc([
				section('s1', 'Metrics', [textBlock('pad', 'x'), tableBlock('t1', [{ metric: 10 }])])
			]);
			const newDoc = doc([
				section('s1', 'Metrics', [tableBlock('t1', [{ metric: 20 }]), textBlock('pad', 'x')])
			]);

			const block = blockById(asDiff(diffSnapshots(newDoc, oldDoc)), 't1');

			expect(block.change).toBe('moved');
			expect(block.dataChanged).toBe(true);
		});
	});

	describe('content diff on kept blocks', () => {
		it('flags a text block whose prose changed as a content change, never a data change', () => {
			const oldDoc = doc([section('s1', 'Intro', [textBlock('b1', 'Old prose')])]);
			const newDoc = doc([section('s1', 'Intro', [textBlock('b1', 'New prose')])]);

			const block = blockById(asDiff(diffSnapshots(newDoc, oldDoc)), 'b1');

			expect(block.change).toBe('kept');
			expect(block.contentChanged).toBe(true);
			expect(block.dataChanged).toBe(false);
		});
	});

	describe('substantial drift', () => {
		it('returns a neutral drift verdict when the two snapshots share no block ids', () => {
			const oldDoc = doc([section('s1', 'Intro', [textBlock('a1', 'a'), textBlock('a2', 'b')])]);
			const newDoc = doc([section('s2', 'Other', [textBlock('z1', 'x'), textBlock('z2', 'y')])]);

			const result = diffSnapshots(newDoc, oldDoc);

			expect(result.kind).toBe('substantial-drift');
			if (result.kind === 'substantial-drift') expect(result.overlap).toBe(0);
		});

		it('returns drift when overlap is below the threshold (one stray coincidental match)', () => {
			// 1 shared id out of 11 old / 11 new = ~0.09 overlap, below 0.1.
			const oldBlocks = [
				textBlock('shared', 's'),
				...range(10).map((i) => textBlock(`old${i}`, 'o'))
			];
			const newBlocks = [
				textBlock('shared', 's'),
				...range(10).map((i) => textBlock(`new${i}`, 'n'))
			];
			const oldDoc = doc([section('s1', 'Intro', oldBlocks)]);
			const newDoc = doc([section('s1', 'Intro', newBlocks)]);

			const result = diffSnapshots(newDoc, oldDoc);

			expect(result.kind).toBe('substantial-drift');
		});

		it('does NOT flag drift on a normal refill (ids inherited, content changed)', () => {
			const oldDoc = doc([
				section('s1', 'Intro', [textBlock('b1', 'Old'), tableBlock('t1', [{ metric: 1 }])])
			]);
			const newDoc = doc([
				section('s1', 'Intro', [textBlock('b1', 'New'), tableBlock('t1', [{ metric: 2 }])])
			]);

			expect(diffSnapshots(newDoc, oldDoc).kind).toBe('diff');
		});

		it('does NOT flag drift when a small issue grew a lot but kept every old id (heavy add)', () => {
			// Every old id survives (overlap 1.0 against the smaller old set); the new
			// issue merely added many blocks. A heavy add is not a rebuild.
			const oldDoc = doc([section('s1', 'Intro', [textBlock('b1', 'a')])]);
			const newBlocks = [
				textBlock('b1', 'a'),
				...range(50).map((i) => textBlock(`extra${i}`, 'x'))
			];
			const newDoc = doc([section('s1', 'Intro', newBlocks)]);

			expect(diffSnapshots(newDoc, oldDoc).kind).toBe('diff');
		});

		it('treats a pair with no blocks on either side as drift, never a divide-by-zero', () => {
			const empty = doc([section('s1', 'Intro', [])]);
			expect(diffSnapshots(empty, structuredClone(empty)).kind).toBe('substantial-drift');
		});

		it('exposes a threshold low enough that a half-shared pair still diffs', () => {
			// Sanity check on the constant so the threshold rationale is pinned by a test.
			expect(SUBSTANTIAL_DRIFT_THRESHOLD).toBeLessThanOrEqual(0.5);
			expect(SUBSTANTIAL_DRIFT_THRESHOLD).toBeGreaterThan(0);
		});
	});

	describe('determinism', () => {
		it('produces byte-identical output for the same inputs across runs', () => {
			const oldDoc = doc([
				section('s1', 'Intro', [textBlock('b1', 'Old'), tableBlock('t1', [{ metric: 1 }])]),
				section('s2', 'Body', [kpiBlock('k1', 5)])
			]);
			const newDoc = doc([
				section('s2', 'Body', [kpiBlock('k1', 9)]),
				section('s1', 'Intro', [tableBlock('t1', [{ metric: 2 }]), textBlock('b1', 'Old')])
			]);

			const first = JSON.stringify(diffSnapshots(newDoc, oldDoc));
			const second = JSON.stringify(
				diffSnapshots(structuredClone(newDoc), structuredClone(oldDoc))
			);

			expect(first).toBe(second);
		});

		it('never throws on a structurally corrupted pair (duplicate block ids)', () => {
			const corrupted = doc([
				section('s1', 'Intro', [textBlock('dupe', 'a'), textBlock('dupe', 'b')])
			]);
			expect(() => diffSnapshots(corrupted, structuredClone(corrupted))).not.toThrow();
		});
	});
});

/** [0, 1, ..., n-1], for building bulk fixtures. */
function range(n: number): number[] {
	return Array.from({ length: n }, (_, i) => i);
}
