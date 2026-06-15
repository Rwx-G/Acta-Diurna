/**
 * Canonical Zod-issue-path formatter, kept in its OWN leaf module (no schema,
 * registry, or migration imports) so any consumer can reuse it without dragging
 * heavier graph into its bundle. `errors.ts` (the server validate-on-write path)
 * and the WYSIWYG editor's optimistic validation both format issue paths the same
 * way; co-locating the single implementation here removes the copy-discipline gap
 * AND keeps the reader path byte-identical (the editor's import of this leaf never
 * pulls `errors.ts`/the version registry into a reader-shared chunk).
 */

/** Formats a zod issue path as a human-readable pointer, e.g. `sections[2].blocks[0].alt`. */
export function formatIssuePath(path: ReadonlyArray<PropertyKey>): string {
	if (path.length === 0) {
		return 'document';
	}
	let formatted = '';
	for (const segment of path) {
		if (typeof segment === 'number') {
			formatted += `[${segment}]`;
		} else {
			formatted += formatted === '' ? String(segment) : `.${String(segment)}`;
		}
	}
	return formatted;
}
