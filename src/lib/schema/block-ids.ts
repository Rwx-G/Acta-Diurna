/**
 * Document-level uniqueness pass for block ids (Epic 9+10 solidification follow-up).
 *
 * A block id is the load-bearing primitive behind three Epic 9 engines that all
 * assume an id names EXACTLY one block, first-occurrence-wins: the series diff
 * (`series-diff.ts` `placeBlocks`), the publish-time delta bake (`bake-delta.ts`
 * `indexKpiByIdOf`), and the change-summary builder. A document with two blocks
 * sharing an id silently drops the second block's delta and movement at publish
 * time, with no error at any layer below this one - the second occurrence is never
 * matched, so its data change goes unannounced.
 *
 * This pass closes that gap: it walks every block of `document.sections`, and the
 * second (and later) occurrence of any id - across the WHOLE document, not just
 * within a section - is flagged as an FR2 problem-details error at save/API time,
 * never reaching a reader. It is the structural twin of `section-ids.ts`
 * `validateSectionIds` and wires into the same document superRefine
 * (`versions/v1.ts`).
 *
 * Isomorphic by design: this module imports nothing from `$lib/server` or
 * `$lib/ui`. It reads only the structural shape of a block (the blocks have already
 * passed their own zod validation - id format, required fields - before this pass
 * runs), so it imports no block schema value.
 */

/**
 * One duplicate block id found by the document-level pass. Path-shaped for FR2
 * problem-details emission, mirroring `SectionIdIssue` / `InternalLinkIssue`.
 */
export interface BlockIdIssue {
	/** Path to the offending (duplicate) block's id, as a zod issue path. */
	path: PropertyKey[];
	message: string;
	hint: string;
}

/** Structural view of a block: only its id is read by this pass. */
interface BlockView {
	id?: unknown;
}

/** Structural view of a section: only its blocks are read by this pass. */
interface SectionView {
	blocks?: ReadonlyArray<BlockView>;
}

/** Structural view of a document for the block-id uniqueness pass. */
interface DocumentView {
	sections: ReadonlyArray<SectionView>;
}

/**
 * Detects any block id reused anywhere in the document. The FIRST occurrence of an
 * id is the canonical one and passes; every later occurrence is flagged at its own
 * `sections[s].blocks[b].id` path, so the error points at the block that must be
 * renamed rather than at the original. Uniqueness is document-wide (a block id is
 * matched across sections by the diff/bake engines), so a collision between two
 * sections is flagged exactly like one within a section. The message names the
 * duplicated id and states the rule, so a producer (workspace/REST/MCP/AI) gets one
 * actionable fix per offending block.
 */
export function validateBlockIds(document: DocumentView): BlockIdIssue[] {
	const issues: BlockIdIssue[] = [];
	const seen = new Set<string>();

	for (let s = 0; s < document.sections.length; s += 1) {
		const blocks = document.sections[s].blocks ?? [];
		for (let b = 0; b < blocks.length; b += 1) {
			const id = blocks[b].id;
			if (typeof id !== 'string') {
				continue;
			}
			if (seen.has(id)) {
				issues.push({
					path: ['sections', s, 'blocks', b, 'id'],
					message: `Duplicate block id "${id}": block ids must be unique within a document.`,
					hint: `Another block already uses the id "${id}". Give this block a distinct id so the series diff, the publish-time delta bake, and the change summary each resolve to exactly one block (a duplicate id silently drops the second block's delta and movement).`
				});
			} else {
				seen.add(id);
			}
		}
	}
	return issues;
}
