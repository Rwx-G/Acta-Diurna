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

// TYPE-ONLY import: this keeps the module isomorphic (`import type` is erased at
// build, so no schema value is pulled in) while pinning DATA_FIELD_BY_TYPE to the
// real bindable block shapes - a schema rename of a data field then breaks the
// build here, not silently at runtime.
import type { BindableBlock } from './blocks/bindable.ts';

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

/**
 * Each bindable block type mapped to the NAME of its data-bearing field, pinned to
 * the real schema shape: the value for `T` must be a key of the bindable block
 * variant whose `type` is `T`. A schema rename (or a new bindable block without a
 * data field declared here) is then a compile error, not a silently muted
 * data-change detection.
 */
type DataFieldByType = {
	[T in BindableBlock['type']]: keyof Extract<BindableBlock, { type: T }> & string;
};

/** The block types whose data-bearing field carries resolved bound values. */
const DATA_FIELD_BY_TYPE = {
	table: 'rows',
	chart: 'series',
	kpi: 'items'
} as const satisfies DataFieldByType;

/** Resolves the data field name for a block type, or undefined for a non-bound type. */
function dataFieldKey(type: string): string | undefined {
	return (DATA_FIELD_BY_TYPE as Readonly<Record<string, string>>)[type];
}

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

/**
 * Structural verdict for a block OR a section, matched by id across the two
 * snapshots: in both is `kept` (or `moved` if its position/parent changed), only in
 * the new is `added`, only in the old is `removed`. Shared by {@link BlockDiff} and
 * {@link SectionDiff} so the two carry the same verdict vocabulary.
 */
export type ChangeVerdict = 'added' | 'removed' | 'moved' | 'kept';

/** The per-block result: its structural verdict plus the data/content flags. */
export interface BlockDiff {
	/** The stable block id (the same id in both snapshots when matched). */
	id: string;
	/** The block `type` (from the new snapshot when present, else the old). */
	type: string;
	/** Structural verdict: added / removed / moved / kept. */
	change: ChangeVerdict;
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
	change: ChangeVerdict;
	/** The block diffs under this section, in new-snapshot order (old order for a removed section). */
	blocks: BlockDiff[];
}

/** A computed diff between two snapshots that lined up well enough to compare. */
export interface ComputedDiff {
	kind: 'diff';
	sections: SectionDiff[];
}

/**
 * No published snapshot to compare against, with the two distinct causes kept
 * separate so a consumer (9.5) can message them differently:
 * - `first-issue`: this is the first issue of the series (no predecessor edge).
 * - `predecessor-unpublished`: a predecessor exists but is not published yet, so it
 *   has no frozen edition to diff against.
 */
export interface NoPredecessorDiff {
	kind: 'no-predecessor';
	reason: 'first-issue' | 'predecessor-unpublished';
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
 * The overlap ratio of two placed-block maps (keyed by id): shared / min(old, new).
 * Iterates the maps directly (no intermediate Sets) since a `Map.has`/`Map.size`
 * answers id membership and count already. Returns 0 when either snapshot has no
 * blocks (nothing to line up), so an empty pair is always drift rather than a
 * divide-by-zero.
 */
function blockOverlap(
	oldPlaced: ReadonlyMap<string, PlacedBlock>,
	newPlaced: ReadonlyMap<string, PlacedBlock>
): number {
	const smaller = Math.min(oldPlaced.size, newPlaced.size);
	if (smaller === 0) return 0;
	let shared = 0;
	for (const id of newPlaced.keys()) {
		if (oldPlaced.has(id)) shared += 1;
	}
	return shared / smaller;
}

/**
 * Canonical JSON of a plain-JSON value with object keys SORTED, so equality is
 * correct-by-construction regardless of the key order the caller's snapshot happens
 * to carry. Raw `JSON.stringify` is key-order-sensitive: two equal blocks whose
 * fields were serialized in a different key order (a future reader path, an
 * MCP-authored snapshot, or a cache that re-keyed the JSONB) would otherwise read
 * as a phantom data/content change. Arrays are kept in order - order is meaningful
 * for sections, rows, and paragraphs, so reordering them IS a real change. The
 * `structural-equality.ts` precedent normalizes the same way before comparing.
 */
function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') {
		return JSON.stringify(value) ?? 'null';
	}
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(',')}]`;
	}
	const entries = Object.keys(value as Record<string, unknown>)
		.sort()
		.map(
			(key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`
		);
	return `{${entries.join(',')}}`;
}

/**
 * Stable structural equality by canonical, key-sorted JSON. The block fields are
 * plain JSON (strings, numbers, booleans, null, arrays, objects with string keys);
 * {@link stableStringify} normalizes object key order so the compare is deep,
 * deterministic, and independent of whatever key order the snapshot was serialized
 * with. This is the same normalize-then-compare strategy `structural-equality.ts`
 * uses on its fingerprints.
 */
function deepEqual(a: unknown, b: unknown): boolean {
	return stableStringify(a) === stableStringify(b);
}

/** The resolved bound-data value of a block (rows/series/items), or undefined for a non-bound type. */
function dataField(block: DiffBlock): unknown {
	const key = dataFieldKey(block.type);
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
	const dataKey = dataFieldKey(block.type);
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
): ChangeVerdict {
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
 * `oldSnapshot` null means there is no published predecessor -> a neutral
 * `no-predecessor` result; `noPredecessorReason` records WHICH cause (the first
 * issue, default, or an existing-but-unpublished predecessor) so a consumer can
 * message them apart. When the two snapshots share almost no block ids (overlap
 * below {@link SUBSTANTIAL_DRIFT_THRESHOLD}) -> a neutral `substantial-drift`
 * verdict. Otherwise a full per-section, per-block `diff`.
 */
export function diffSnapshots(
	newSnapshot: DiffDocument,
	oldSnapshot: DiffDocument | null,
	noPredecessorReason: NoPredecessorDiff['reason'] = 'first-issue'
): SeriesDiff {
	if (oldSnapshot === null) {
		return { kind: 'no-predecessor', reason: noPredecessorReason };
	}

	const oldPlaced = placeBlocks(oldSnapshot);
	const newPlaced = placeBlocks(newSnapshot);
	const overlap = blockOverlap(oldPlaced, newPlaced);
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
