/**
 * Editor primitives shared by the 1.5 report editor and the 2.1 skeleton
 * composer: list reordering, validation-error-to-element mapping, path
 * humanizing, the issue types, and the document body-size cap. Both routes are
 * structure editors over a `DocumentV1`, so these live in `$lib` rather than
 * being re-exported across routes. Pure: no DOM, no Drizzle.
 */
import type { ValidationErrorDetail } from '$lib/schema';

export type EditorIssue = ValidationErrorDetail;

/** Issues grouped by editor location: `document`, `section:<id>` or `block:<id>`. */
export type ErrorsByKey = Record<string, EditorIssue[]>;

/**
 * Upper bound on the serialized document a save action will `JSON.parse`. A
 * structure-first document is small (no embedded assets); a payload past this is
 * either a bug or abuse, so the action rejects it with 413 before parsing rather
 * than spending memory on an oversized parse.
 */
export const MAX_DOCUMENT_BYTES: number = 1_000_000;

/** Swaps an item with its neighbor in place; out-of-bounds moves are no-ops. */
export function moveItem<T>(items: T[], index: number, direction: -1 | 1): void {
	const target = index + direction;
	if (index < 0 || index >= items.length || target < 0 || target >= items.length) return;
	const [moved] = items.splice(index, 1);
	items.splice(target, 0, moved);
}

/**
 * Turns a validation error path into a readable field label for the author:
 * the last non-index segment with separators normalised. `sections[0].blocks[2]
 * .items[1].label` becomes `label`, `sections[0].title` becomes `title`. The
 * raw indexed path is noise to a human; the inline placement already says which
 * block the error belongs to.
 */
export function humanizePath(path: string): string {
	const segments = path
		.replace(/\[\d+\]/g, '')
		.split('.')
		.filter((segment) => segment.length > 0);
	const last = segments.at(-1) ?? path;
	return last.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

const LOCATION_PATTERN = /^sections\[(\d+)\](?:\.blocks\[(\d+)\])?/;

interface DocumentShape {
	sections: { id: string; blocks: { id: string }[] }[];
}

/**
 * Maps validation error paths (index-based, from the submitted document) to
 * stable section/block ids so each error renders inline at the failing block
 * even if the author reorders things before fixing. Paths that name no
 * existing section or block fall back to the `document` group.
 */
export function groupErrorsByLocation(
	errors: readonly EditorIssue[],
	document: DocumentShape
): ErrorsByKey {
	const grouped: ErrorsByKey = {};
	for (const issue of errors) {
		const match = LOCATION_PATTERN.exec(issue.path);
		const section = match ? document.sections[Number(match[1])] : undefined;
		const block = match?.[2] !== undefined ? section?.blocks[Number(match[2])] : undefined;
		const key = block ? `block:${block.id}` : section ? `section:${section.id}` : 'document';
		(grouped[key] ??= []).push(issue);
	}
	return grouped;
}
