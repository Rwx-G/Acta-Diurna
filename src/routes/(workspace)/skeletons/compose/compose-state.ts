/**
 * Pure composer helpers (UX Flow A): the in-memory skeleton draft and the
 * operations the StructureTree performs on it - append a brick, reorder/remove
 * sections and blocks, rename inline. No DOM, no Drizzle, so the same helpers
 * back the client component and the unit tests.
 *
 * A skeleton IS a `DocumentV1Input` (story 2.1 Dev Notes): structure + binding
 * expectations, no data. The list-reordering and error-grouping primitives are
 * reused from the 1.5 block editor (`editor-state`) - the composer is the
 * structure-first sibling of that editor, so they share one implementation.
 */
import type { Brick, SkeletonSection } from '$lib/bricks';
import type { DocumentV1Input } from '$lib/schema';

export {
	groupErrorsByLocation,
	humanizePath,
	moveItem
} from '../../reports/[id]/edit/editor-state.ts';
export type { EditorIssue, ErrorsByKey } from '../../reports/[id]/edit/editor-state.ts';

/** The default title a fresh composer opens with; renamed before save. */
export const DEFAULT_SKELETON_TITLE = 'Untitled skeleton';

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

/** Appends a brick's section to the end of the structure (click-to-add). */
export function appendBrick(sections: SkeletonSection[], brick: Brick): void {
	sections.push(brick.factory());
}
