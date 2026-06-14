/**
 * Publish-time delta baking (Epic 9, Story 9.4).
 *
 * Stamps the numeric {@link BindingDelta} onto a KPI block's binding by comparing
 * this issue's resolved value to the id-matched block in the predecessor's published
 * snapshot. This is the server side of the precompute-onto-the-binding pattern set by
 * `data_as_of` (Story 6.4): the bake runs once at publish, freezes the delta into the
 * new issue's snapshot, and the PURE renderer reads it straight off the validated
 * document - no `$lib/server` in the render path, no client compute, and the prior
 * issue's raw data is never shipped to the reader (only the computed delta is).
 *
 * Scope (Story 9.4, the conservative floor): KPI deltas only. The epic flagged
 * "whether table-cell deltas are v2-scope or KPI-only first" as an OPEN kickoff
 * question, and the AC reads "a data-bound KPI block (and, where it applies, a table
 * cell)" - permissive, with no mandate. So this bakes the unambiguous KPI core; table
 * cells are deferred to a kickoff confirmation rather than guessed expansively. When
 * the decision lands, the matched-block walk extends to tables here, and the engine
 * already matches every block by id.
 *
 * Matching is strictly BY STABLE BLOCK ID, the same precondition the diff engine
 * relies on (Story 9.1: `duplicateReport` keeps ids across issues). A KPI block whose
 * id has no match in the predecessor, whose value or the prior value is non-numeric,
 * or whose predecessor block is not a KPI, simply gets no `delta` baked - the
 * omit-rather-than-mislead rule, never a zero or fabricated movement.
 */
import { computeBindingDelta, type ComparableValue, type DocumentV1 } from '$lib/schema';

/**
 * A KPI block's single comparable figure: the value of its sole item. A MULTI-item KPI
 * has no single binding-level figure (a binding-level delta would be ambiguous - which
 * item does it annotate?), so it yields `undefined` and bakes no delta - the
 * omit-rather-than-mislead rule. The bound-KPI delta contract is therefore
 * single-item by construction.
 */
function kpiValue(block: { items?: { value: ComparableValue }[] }): ComparableValue {
	if (block.items === undefined || block.items.length !== 1) return undefined;
	return block.items[0].value;
}

/**
 * Indexes every KPI block of a snapshot by its stable id, for id-matched lookup of the
 * prior value. ALL KPI blocks are indexed, bound or static: a predecessor's static
 * (hand-typed) KPI carries a perfectly comparable prior figure, and the delta is
 * defined by the value at a stable id, not by whether that predecessor block declared a
 * binding. Only the CURRENT block's binding gates eligibility (a delta is a property of
 * bound data on the issue being published); the predecessor side is value-only.
 *
 * On a duplicate block id (impossible in a validated document, but the bake is total
 * against a hand-corrupted snapshot) the FIRST occurrence wins, matching the 9.2 diff
 * engine's `placeBlocks` - so the two id-matching engines agree on a corrupted document
 * rather than diverging (last-write-wins here vs first-occurrence-wins there).
 */
function indexKpiByIdOf(document: DocumentV1): Map<string, ComparableValue> {
	const byId = new Map<string, ComparableValue>();
	for (const section of document.sections) {
		for (const block of section.blocks) {
			if (block.type === 'kpi' && !byId.has(block.id)) byId.set(block.id, kpiValue(block));
		}
	}
	return byId;
}

/**
 * Returns a copy of `published` with the Story 9.4 numeric delta baked onto each
 * delta-eligible KPI block's binding, computed against `predecessor`. A KPI block is
 * delta-eligible only when it carries a `binding` (a delta is a property of bound
 * data, not a hand-typed figure). `predecessor` null - a first issue or an
 * unpublished predecessor - bakes no delta anywhere and returns the document
 * structurally unchanged.
 *
 * The published document passed in is already validated; this never mutates it (it
 * rebuilds the section/block spine so the stored snapshot and any in-memory copy stay
 * independent), and the result is re-validated by the caller before it is frozen.
 */
export function bakeBindingDeltas(
	published: DocumentV1,
	predecessor: DocumentV1 | null
): DocumentV1 {
	if (predecessor === null) return published;

	const priorById = indexKpiByIdOf(predecessor);
	// A predecessor with no KPI blocks at all (so no id can match) can never PRODUCE a
	// delta. The bake site (`publishReport`) feeds the draft `document`, which the bake
	// never stamps - so the input here carries no prior delta to DROP either. Skip the
	// section/block rebuild and return the input unchanged.
	if (priorById.size === 0) return published;

	return {
		...published,
		sections: published.sections.map((section) => ({
			...section,
			blocks: section.blocks.map((block) => {
				if (block.type !== 'kpi' || block.binding === undefined) return block;
				const delta = computeBindingDelta(kpiValue(block), priorById.get(block.id));
				if (delta === undefined) {
					// No comparable prior value: omit the delta. A republish of a block that
					// previously carried one drops it rather than freezing a stale figure.
					if (block.binding.delta === undefined) return block;
					const binding = { ...block.binding };
					delete binding.delta;
					return { ...block, binding };
				}
				return { ...block, binding: { ...block.binding, delta } };
			})
		}))
	};
}
