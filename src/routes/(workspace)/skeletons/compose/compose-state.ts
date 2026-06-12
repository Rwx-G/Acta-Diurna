/**
 * Pure composer helpers (UX Flow A): the in-memory skeleton draft and the
 * operations the StructureTree performs on it - append a brick, reorder/remove
 * sections and blocks, rename inline. No DOM, no Drizzle, so the same helpers
 * back the client component and the unit tests.
 *
 * A skeleton IS a `DocumentV1Input` (story 2.1 Dev Notes): structure + binding
 * expectations, no data. The list-reordering and error-grouping primitives are
 * the shared `$lib/editor` ones - the composer is the structure-first sibling of
 * the 1.5 block editor, so both consume one implementation.
 */
import type { Brick, SkeletonSection } from '$lib/bricks';
import type { DocumentV1Input } from '$lib/schema';

export { groupErrorsByLocation, humanizePath, moveItem } from '$lib/editor';
export type { EditorIssue, ErrorsByKey } from '$lib/editor';

/** The default title a fresh composer opens with; renamed before save. */
export const DEFAULT_SKELETON_TITLE = 'Untitled skeleton';

/** Removes the section at `index` in place; out-of-bounds is a no-op. */
export function removeSection(sections: SkeletonSection[], index: number): void {
	if (index < 0 || index >= sections.length) return;
	sections.splice(index, 1);
}

/**
 * A fresh skeleton draft. Per UX Flow A the composer opens with a starter Cover
 * brick so the author never faces a blank structure.
 */
export function newSkeletonDraft(coverBrick: Brick): DocumentV1Input {
	return {
		version: 1,
		title: DEFAULT_SKELETON_TITLE,
		sections: [coverBrick.factory()]
	};
}

/**
 * Appends a brick's section to the end of the structure (click-to-add), and
 * seeds any companion scales (Epic 7) the brick's block references so the
 * assembled document resolves them. A scale whose key is already on the draft is
 * not duplicated (unique scale keys are a document constraint), so re-adding the
 * matrix brick reuses the existing scales.
 */
export function appendBrick(draft: DocumentV1Input, brick: Brick): void {
	draft.sections.push(brick.factory());
	const companionScales = brick.scales?.();
	if (!companionScales || companionScales.length === 0) return;
	const existing = (draft.scales ??= []);
	for (const scale of companionScales) {
		if (!existing.some((seeded) => seeded.key === scale.key)) {
			existing.push(scale);
		}
	}
}
