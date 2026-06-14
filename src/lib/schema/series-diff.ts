/**
 * Snapshot diff engine for report series (Epic 9, Story 9.2).
 *
 * A pure, isomorphic function that compares two PUBLISHED snapshots - a new issue
 * and its predecessor in the same series - into a typed {@link SeriesDiff}. The
 * engine is the single authoritative source feeding both the workspace "what
 * changed" view (9.3) and the optional reader-facing change summary (9.5), so the
 * two surfaces can never drift on what "changed" means.
 *
 * Isomorphic by design: this module imports nothing from `$lib/server` or
 * `$lib/ui` (the same boundary as `internal-links.ts` / `section-ids.ts`). The
 * caller resolves both snapshots under one `AuthorScope` and passes the two
 * validated documents in; owner scoping is enforced at the fetch, never here. The
 * result is derived, never persisted, and reproducible / cacheable by the
 * `(new, old)` snapshot pair because both snapshots are immutable.
 *
 * Matching is strictly BY STABLE BLOCK / SECTION ID, the precondition story 9.1
 * guarantees (`duplicateReport` deep-copies and KEEPS ids, so issue N's blocks
 * carry the same ids as issue N-1). An id present in both snapshots is `kept` (or
 * `moved` if its position changed), only in the new is `added`, only in the old is
 * `removed`. There is NO fuzzy text matching: a manually rebuilt block (new id)
 * reads as a clean add/remove pair, never a fabricated rename.
 *
 * The three diff dimensions on a kept block:
 * - STRUCTURAL: added / removed / moved / kept (position + parent section).
 * - DATA: for a data-bound block (table/chart/kpi), whether the resolved bound
 *   values differ - the data-bearing field (rows / series / items), read straight
 *   off the snapshot (it already carries resolved data, so no data set is re-read).
 * - CONTENT: whether any non-data field differs (text, labels, titles, options).
 *
 * Graceful degradation: when the two snapshots share almost no block ids (a series
 * link to an unrelated report, or a fully rebuilt issue) the engine returns a
 * neutral `substantial-drift` verdict rather than a misleading wall of adds and
 * removes. With no published predecessor (first issue, or an unpublished
 * predecessor) it returns a neutral `no-predecessor` result. Neither throws.
 */

/**
 * A document the diff engine reads. Structural superset of the validated
 * `DocumentV1` (the engine reads only `sections` and the block shape), kept local
 * so this module imports no schema value and stays isomorphic - the documents have
 * already passed zod validation before reaching here.
 */
export interface DiffDocument {
	sections: ReadonlyArray<DiffSection>;
}

interface DiffSection {
	id: string;
	title: string;
	blocks: ReadonlyArray<DiffBlock>;
}

interface DiffBlock {
	type: string;
	id: string;
}

/** A block read as a flat record, to reach the non-id/type fields (data and content). */
type BlockFields = Readonly<Record<string, unknown>>;

function fieldsOf(block: DiffBlock): BlockFields {
	return block as unknown as BlockFields;
}

/** The block types whose data-bearing field carries resolved bound values. */
const DATA_FIELD_BY_TYPE: Readonly<Record<string, string>> = {
	table: 'rows',
	chart: 'series',
	kpi: 'items'
};

/**
 * The overlap below which two snapshots are declared substantially drifted. The
 * ratio is `shared block ids / min(old block count, new block count)`: it answers
 * "of the smaller snapshot, what fraction of blocks survived by id?". `min` (not
 * the union) is the right denominator so a small issue that grew a lot is not
 * falsely flagged as drift - if every old block survived into a much larger new
 * issue, that is a heavy ADD, not a rebuild, and the overlap is still 1.0.
 *
 * 0.1 (10%) is the threshold: below it, almost nothing lines up by id, so a
 * per-block comparison would be a noisy false diff (a wall of adds and removes
 * with a stray coincidental match). A zero-overlap pair (no shared ids at all -
 * the AC's unrelated-report case) is always below it and so always drift. A normal
 * refill (same skeleton, ids inherited) sits at or near 1.0 and never trips it. A
 * pair with no blocks on either side is treated as fully drifted (nothing to
 * compare), never a divide-by-zero.
 */
export const SUBSTANTIAL_DRIFT_THRESHOLD = 0.1;

/** Structural verdict for one block, matched by id across the two snapshots. */
export type BlockChange = 'added' | 'removed' | 'moved' | 'kept';

/** The per-block result: its structural verdict plus the data/content flags. */
export interface BlockDiff {
	/** The stable block id (the same id in both snapshots when matched). */
	id: string;
	/** The block `type` (from the new snapshot when present, else the old). */
	type: string;
	/** Structural verdict: added / removed / moved / kept. */
	change: BlockChange;
	/**
	 * True when this is a data-bound block (table/chart/kpi) whose resolved bound
	 * values (rows/series/items) differ between snapshots. Only meaningful for a
	 * `kept` or `moved` block matched in both snapshots; false otherwise.
	 */
	dataChanged: boolean;
	/**
	 * True when any non-data field of the block (text, labels, titles, options)
	 * differs between snapshots. Only meaningful for a matched block; false for an
	 * `added` / `removed` block.
	 */
	contentChanged: boolean;
}

/** The per-section result: its structural verdict plus its block diffs. */
export interface SectionDiff {
	/** The stable section id. */
	id: string;
	/** The section title (from the new snapshot when present, else the old). */
	title: string;
	/** Structural verdict for the section itself. */
	change: BlockChange;
	/** The block diffs under this section, in new-snapshot order (old order for a removed section). */
	blocks: BlockDiff[];
}

/** A computed diff between two snapshots that lined up well enough to compare. */
export interface ComputedDiff {
	kind: 'diff';
	sections: SectionDiff[];
}

/** No published predecessor: the first issue, or an unpublished predecessor. */
export interface NoPredecessorDiff {
	kind: 'no-predecessor';
}

/** The two snapshots share almost no block ids: a per-block comparison would mislead. */
export interface SubstantialDriftDiff {
	kind: 'substantial-drift';
	/** The overlap ratio that fell below {@link SUBSTANTIAL_DRIFT_THRESHOLD}, for diagnostics. */
	overlap: number;
}

/** The typed result of the diff engine, discriminated on `kind`. */
export type SeriesDiff = ComputedDiff | NoPredecessorDiff | SubstantialDriftDiff;

/** A block paired with the section it sits in and its index within that section. */
interface PlacedBlock {
	block: DiffBlock;
	sectionId: string;
	index: number;
}

/** Indexes every block of a document by its id, with its section and position. */
function placeBlocks(document: DiffDocument): Map<string, PlacedBlock> {
	const placed = new Map<string, PlacedBlock>();
	for (const section of document.sections) {
		for (let index = 0; index < section.blocks.length; index += 1) {
			const block = section.blocks[index];
			// A duplicate block id is impossible in a validated document, but the engine
			// is total: the first occurrence wins, so a hand-corrupted snapshot degrades
			// to a consistent match rather than throwing.
			if (!placed.has(block.id)) {
				placed.set(block.id, { block, sectionId: section.id, index });
			}
		}
	}
	return placed;
}

/**
 * The overlap ratio of two block-id sets: shared / min(old, new). Returns 0 when
 * either snapshot has no blocks (nothing to line up), so an empty pair is always
 * drift rather than a divide-by-zero.
 */
function blockOverlap(oldIds: ReadonlySet<string>, newIds: ReadonlySet<string>): number {
	const smaller = Math.min(oldIds.size, newIds.size);
	if (smaller === 0) return 0;
	let shared = 0;
	for (const id of newIds) {
		if (oldIds.has(id)) shared += 1;
	}
	return shared / smaller;
}

/**
 * Stable structural equality by canonical JSON. The block fields are plain JSON
 * (strings, numbers, booleans, null, arrays, objects with string keys), and both
 * snapshots are produced by the same serializer, so key order is stable and a
 * canonical `JSON.stringify` compares deeply and deterministically. This is the
 * same comparison strategy `structural-equality.ts` uses on its fingerprints.
 */
function deepEqual(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/** The resolved bound-data value of a block (rows/series/items), or undefined for a non-bound type. */
function dataField(block: DiffBlock): unknown {
	const key = DATA_FIELD_BY_TYPE[block.type];
	return key === undefined ? undefined : fieldsOf(block)[key];
}

/**
 * The non-data fields of a block: every own field except its `id`, `type`, and -
 * for a bound block - its data-bearing field (which is the DATA dimension, not
 * CONTENT). What remains is the content surface: text, labels, titles, options,
 * bindings' declared fields. Comparing the remainder catches a content edit
 * without re-flagging a data edit as content too.
 */
function contentView(block: DiffBlock): Record<string, unknown> {
	const dataKey = DATA_FIELD_BY_TYPE[block.type];
	const fields = fieldsOf(block);
	const view: Record<string, unknown> = {};
	for (const key of Object.keys(fields)) {
		if (key === 'id' || key === 'type' || key === dataKey) continue;
		view[key] = fields[key];
	}
	return view;
}

/** Diffs a block present in BOTH snapshots: its data and content dimensions. */
function diffMatchedBlock(oldPlaced: PlacedBlock, newPlaced: PlacedBlock): BlockDiff {
	const moved = oldPlaced.sectionId !== newPlaced.sectionId || oldPlaced.index !== newPlaced.index;
	const dataChanged = !deepEqual(dataField(oldPlaced.block), dataField(newPlaced.block));
	const contentChanged = !deepEqual(contentView(oldPlaced.block), contentView(newPlaced.block));
	return {
		id: newPlaced.block.id,
		type: newPlaced.block.type,
		change: moved ? 'moved' : 'kept',
		dataChanged,
		contentChanged
	};
}

/** Builds the block diffs for a section, walking the new order then any removed blocks. */
function diffSectionBlocks(
	newSection: DiffSection | undefined,
	oldSection: DiffSection | undefined,
	oldPlaced: Map<string, PlacedBlock>,
	newPlaced: Map<string, PlacedBlock>
): BlockDiff[] {
	const diffs: BlockDiff[] = [];
	// New-snapshot order first: a block matched in the old snapshot is kept/moved, an
	// unmatched one is added. This fixes the displayed order to the current issue.
	for (const block of newSection?.blocks ?? []) {
		const oldMatch = oldPlaced.get(block.id);
		if (oldMatch === undefined) {
			diffs.push({
				id: block.id,
				type: block.type,
				change: 'added',
				dataChanged: false,
				contentChanged: false
			});
		} else {
			diffs.push(diffMatchedBlock(oldMatch, newPlaced.get(block.id)!));
		}
	}
	// Then the blocks that were in this section in the old snapshot and are now gone
	// from the document entirely (a block that merely moved to another section is
	// already reported there as `moved`, so it is not double-counted as removed).
	for (const block of oldSection?.blocks ?? []) {
		if (!newPlaced.has(block.id)) {
			diffs.push({
				id: block.id,
				type: block.type,
				change: 'removed',
				dataChanged: false,
				contentChanged: false
			});
		}
	}
	return diffs;
}

/** Determines a section's structural verdict from its presence and position in each snapshot. */
function sectionChange(
	id: string,
	oldOrder: Map<string, number>,
	newOrder: Map<string, number>
): BlockChange {
	const inOld = oldOrder.has(id);
	const inNew = newOrder.has(id);
	if (inOld && !inNew) return 'removed';
	if (!inOld && inNew) return 'added';
	return oldOrder.get(id) !== newOrder.get(id) ? 'moved' : 'kept';
}

/** Maps each section id to its index in the document, for the moved/kept verdict. */
function sectionOrder(document: DiffDocument): Map<string, number> {
	const order = new Map<string, number>();
	document.sections.forEach((section, index) => {
		if (!order.has(section.id)) order.set(section.id, index);
	});
	return order;
}

/**
 * Diffs two PUBLISHED snapshots into a typed {@link SeriesDiff}. Pure and total:
 * it reads only the two documents passed in, never throws, and returns the same
 * result for the same inputs (a deterministic, cacheable derivation).
 *
 * `oldSnapshot` null means there is no published predecessor (the first issue, or
 * an unpublished predecessor) -> a neutral `no-predecessor` result. When the two
 * snapshots share almost no block ids (overlap below
 * {@link SUBSTANTIAL_DRIFT_THRESHOLD}) -> a neutral `substantial-drift` verdict.
 * Otherwise a full per-section, per-block `diff`.
 */
export function diffSnapshots(
	newSnapshot: DiffDocument,
	oldSnapshot: DiffDocument | null
): SeriesDiff {
	if (oldSnapshot === null) {
		return { kind: 'no-predecessor' };
	}

	const oldPlaced = placeBlocks(oldSnapshot);
	const newPlaced = placeBlocks(newSnapshot);
	const overlap = blockOverlap(new Set(oldPlaced.keys()), new Set(newPlaced.keys()));
	if (overlap < SUBSTANTIAL_DRIFT_THRESHOLD) {
		return { kind: 'substantial-drift', overlap };
	}

	const oldOrder = sectionOrder(oldSnapshot);
	const newOrder = sectionOrder(newSnapshot);
	const oldSections = new Map(oldSnapshot.sections.map((section) => [section.id, section]));
	const newSections = new Map(newSnapshot.sections.map((section) => [section.id, section]));

	const sections: SectionDiff[] = [];
	// New-snapshot section order first (kept/moved/added), then sections removed
	// entirely - the same order discipline as the block walk, so the result reads
	// in the current issue's structure.
	for (const section of newSnapshot.sections) {
		sections.push({
			id: section.id,
			title: section.title,
			change: sectionChange(section.id, oldOrder, newOrder),
			blocks: diffSectionBlocks(section, oldSections.get(section.id), oldPlaced, newPlaced)
		});
	}
	for (const section of oldSnapshot.sections) {
		if (newSections.has(section.id)) continue;
		sections.push({
			id: section.id,
			title: section.title,
			change: 'removed',
			blocks: diffSectionBlocks(undefined, section, oldPlaced, newPlaced)
		});
	}

	return { kind: 'diff', sections };
}
