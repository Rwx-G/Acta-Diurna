/**
 * Reader-facing change-summary builder (Epic 9, Story 9.5).
 *
 * A pure, isomorphic function that distills a {@link SeriesDiff} into the leak-safe
 * {@link ChangeSummary} entries baked onto the published snapshot at publish time.
 * It is the single authoritative source the publish-time bake calls, kept here in
 * the schema package (imports nothing from `$lib/server` or `$lib/ui`, the same
 * boundary as `series-diff.ts` and `binding-delta.ts`) so the bake and the pure
 * renderer can never drift on what the summary contains.
 *
 * The renderer never computes this: the entries are frozen onto the published
 * snapshot at publish time and read straight off the validated document, so no
 * prior-issue raw content ever reaches the reader.
 *
 * The field set (Story 9.5 AC1, "sections added/removed, headline data movements"):
 * - SECTIONS that were added, removed, or updated since the previous issue. A
 *   section is `updated` when it stayed (kept/moved) and any block under it changed
 *   structurally, in data, or in content. A section with no change produces no entry.
 * - HEADLINE DATA MOVEMENTS: the already-baked KPI {@link BindingDelta} of each
 *   data-bound KPI in the section whose data changed. The delta is read straight off
 *   the binding (it was baked by the 9.4 publish-time bake, which the summary bake
 *   runs AFTER), so the summary re-presents a figure the reader is already served on
 *   the block - never a prior raw value.
 *
 * Leak-safety: an entry carries only the section id and title (already in the
 * reader's TOC), the structural verdict (a flag, never prior prose), the section's
 * own audience tags (already on the rendered section, so the reader CSS hides a
 * summary line for a section hidden at the reader's level), and the baked headline
 * movements (already on each KPI binding). No prior-issue block bodies, no speaker
 * notes, no draft content.
 *
 * Omit-rather-than-mislead: a `no-predecessor` or `substantial-drift` diff yields no
 * entries at all (the panel does not appear), the same posture as the `binding.delta`
 * omission - never a misleading or empty summary.
 */
import type { BindableBlock } from './blocks/bindable.ts';
import type { BindingDelta, ChangeSummaryEntry, ChangeSummaryMovement } from './blocks/shared.ts';
import type { DiffDocument, SectionDiff, SeriesDiff } from './series-diff.ts';

// TYPE-ONLY anchor for the delta-bearing block-type filter below. `import type` is
// erased at build, so this pulls no schema value and keeps the module isomorphic while
// pinning the literal to the real bindable-block shape: a rename of the KPI variant then
// breaks the build here, not silently at runtime.
//
// CONTRACT: this filter must track the set of block types that carry a `binding.delta`.
// Today that is KPI only - `bakeBindingDeltas` (Story 9.4) bakes a binding-level delta
// onto KPI blocks alone (a table/chart has no single headline figure). The same coupling
// `series-diff.ts` pins for `DATA_FIELD_BY_TYPE`. When a future delta-eligible block type
// is added (table-cell or chart deltas), extend this set so its movement is not silently
// missed from the summary.
const DELTA_BEARING_BLOCK_TYPE: BindableBlock['type'] = 'kpi';

/**
 * The minimal section/block shape the summary reads off the BAKED new snapshot to
 * recover each section's audience tags and its KPI movements. A structural superset
 * of the validated `DocumentV1` (the builder reads only `sections`, each section's
 * `audiences`, and its KPI blocks' `binding.delta`), kept local so this module pulls
 * no schema value and stays isomorphic - the document has already passed zod
 * validation before reaching the bake.
 */
export interface SummarySourceDocument {
	sections: ReadonlyArray<SummarySourceSection>;
}

interface SummarySourceSection {
	id: string;
	audiences?: readonly string[];
	blocks: ReadonlyArray<SummarySourceBlock>;
}

interface SummarySourceBlock {
	type: string;
	id: string;
	audiences?: readonly string[];
	items?: ReadonlyArray<{ label?: string }>;
	binding?: { delta?: BindingDelta };
}

/** True when a kept/moved section changed in any dimension (structure, data, or content). */
function sectionChanged(section: SectionDiff): boolean {
	if (section.change === 'added' || section.change === 'removed') return true;
	return section.blocks.some(
		(block) =>
			block.change === 'added' ||
			block.change === 'removed' ||
			block.change === 'moved' ||
			block.dataChanged ||
			block.contentChanged
	);
}

/** The change-summary verdict for a section: added/removed are direct; anything else surfaced is `updated`. */
function verdictOf(section: SectionDiff): ChangeSummaryEntry['change'] {
	if (section.change === 'added') return 'added';
	if (section.change === 'removed') return 'removed';
	return 'updated';
}

/**
 * The leak-safe audience tags for a movement: the SAME reader CSS that hides the block
 * must hide its movement line, so a movement is hidden at a level when EITHER its
 * section OR its block is hidden there. That is the INTERSECTION of the two tag sets (a
 * level shows the movement only when both the section and the block show it): a KPI
 * tagged `technical` inside a section visible at `summary` never surfaces its figure at
 * `summary`, so the summary cannot contradict the body at the same level.
 *
 * Untagged means "visible at every level": an untagged side imposes no constraint, so
 * the result falls back to the other side's tags; both untagged yields `undefined` (the
 * movement shows everywhere, like its block). Disjoint tag sets yield an empty set,
 * which the renderer's attribute serializer maps to "hidden at every level" - leak-safe,
 * since the block is never shown when the section is.
 */
function movementAudiences(
	sectionAudiences: readonly string[] | undefined,
	blockAudiences: readonly string[] | undefined
): readonly string[] | undefined {
	const sectionTagged = sectionAudiences !== undefined && sectionAudiences.length > 0;
	const blockTagged = blockAudiences !== undefined && blockAudiences.length > 0;
	if (!sectionTagged && !blockTagged) return undefined;
	if (!sectionTagged) return blockAudiences;
	if (!blockTagged) return sectionAudiences;
	return blockAudiences.filter((tag) => sectionAudiences.includes(tag));
}

/**
 * The headline data movements for a section: the baked KPI delta of each data-bound
 * KPI block whose data changed in the diff. Reads the delta straight off the baked
 * binding (so the figure is the SAME one the reader already sees on the block) and
 * pairs it with the KPI's own single-item label. A multi-item KPI carries no
 * binding-level delta (the 9.4 bake omits it as ambiguous), so it contributes no
 * movement; a KPI whose data did not change, or that carries no baked delta, is
 * skipped - only a real, reader-visible movement is surfaced.
 *
 * Each movement carries the leak-safe intersection of its section's and its block's
 * audience tags (see {@link movementAudiences}), so the reader CSS hides the movement
 * line whenever EITHER the section or the block is hidden at the reader's level - a
 * block-level tag can no longer leak a figure the body conceals at that level.
 *
 * Omit-rather-than-mislead on the label: a KPI with no usable single-item label
 * contributes no movement (rather than falling back to the section title, which would
 * attribute the figure to the wrong subject), consistent with every other missing-data
 * case here. An ADDED section short-circuits to no movements: its blocks are all
 * `added` (no prior value to compare), so none carries a baked delta - the short-circuit
 * makes that contract local and defensive rather than relying on the diff's emergent
 * behaviour.
 */
function movementsFor(
	section: SectionDiff,
	sectionAudiences: readonly string[] | undefined,
	blocksById: ReadonlyMap<string, SummarySourceBlock>
): ChangeSummaryMovement[] {
	if (verdictOf(section) === 'added') return [];
	const movements: ChangeSummaryMovement[] = [];
	for (const block of section.blocks) {
		if (block.type !== DELTA_BEARING_BLOCK_TYPE || !block.dataChanged) continue;
		const source = blocksById.get(block.id);
		const delta = source?.binding?.delta;
		if (delta === undefined) continue;
		const label = source?.items?.[0]?.label;
		if (label === undefined || label.length === 0) continue;
		const audiences = movementAudiences(sectionAudiences, source?.audiences);
		movements.push({
			label,
			delta,
			...(audiences !== undefined
				? { audiences: audiences as ChangeSummaryMovement['audiences'] }
				: {})
		});
	}
	return movements;
}

/** Indexes every block of the baked snapshot by its id, for the KPI delta / label lookup. */
function indexBlocksById(document: SummarySourceDocument): Map<string, SummarySourceBlock> {
	const byId = new Map<string, SummarySourceBlock>();
	for (const section of document.sections) {
		for (const block of section.blocks) {
			if (!byId.has(block.id)) byId.set(block.id, block);
		}
	}
	return byId;
}

/** The audience tags of a section in the baked snapshot, normalized to undefined when empty. */
function audiencesById(document: SummarySourceDocument): Map<string, readonly string[]> {
	const byId = new Map<string, readonly string[]>();
	for (const section of document.sections) {
		if (section.audiences !== undefined && section.audiences.length > 0) {
			byId.set(section.id, section.audiences);
		}
	}
	return byId;
}

/**
 * Builds the leak-safe reader-facing change-summary entries from a {@link SeriesDiff}
 * and the BAKED new snapshot (which already carries the 9.4 KPI deltas). Pure and
 * total: it reads only the diff and the snapshot passed in, never throws, and returns
 * the same result for the same inputs.
 *
 * A computed diff yields one entry per CHANGED section (added / removed / updated),
 * each carrying the section's audience tags and its headline KPI movements, in the
 * diff's section order (the current issue's structure). A `no-predecessor` or
 * `substantial-drift` diff yields an EMPTY array - the panel does not appear, the
 * omit-rather-than-mislead rule.
 *
 * `audiences` is typed as the schema `Audience` set at the bake boundary: the baked
 * snapshot is a validated document, so its section `audiences` are valid audience
 * tags; this module stays isomorphic by reading them as `readonly string[]` and the
 * caller re-validates the assembled summary through the document schema.
 */
export function buildChangeSummaryEntries(
	diff: SeriesDiff,
	baked: SummarySourceDocument
): ChangeSummaryEntry[] {
	if (diff.kind !== 'diff') return [];

	const blocksById = indexBlocksById(baked);
	const audiences = audiencesById(baked);
	const entries: ChangeSummaryEntry[] = [];
	for (const section of diff.sections) {
		if (!sectionChanged(section)) continue;
		const tags = audiences.get(section.id);
		const movements = movementsFor(section, tags, blocksById);
		entries.push({
			sectionId: section.id,
			sectionTitle: section.title,
			change: verdictOf(section),
			...(tags !== undefined ? { audiences: tags as ChangeSummaryEntry['audiences'] } : {}),
			...(movements.length > 0 ? { movements } : {})
		});
	}
	return entries;
}

/**
 * The {@link DiffDocument} view of a validated document, for the bake site to feed the
 * diff engine. Re-exported here so the bake imports one change-summary module rather
 * than reaching into the diff engine's internals. A validated `DocumentV1` is a
 * structural superset of `DiffDocument`, so this is a type-narrowing pass-through.
 */
export type { DiffDocument };
