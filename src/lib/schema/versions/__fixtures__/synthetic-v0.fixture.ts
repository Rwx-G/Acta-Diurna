/**
 * SYNTHETIC v0 fixture - TEST ARTIFACT ONLY. This is NOT a published schema
 * version and is never registered in `schemaRegistry` or `DOCUMENT_MIGRATIONS`.
 * Its sole purpose is to exercise the real N/N-1 migration mechanism (FR7) end
 * to end before a genuine v2 exists: a stored document at version 0 is lifted to
 * the current v1 shape through `syntheticV0Migration` and then validates.
 *
 * The pretend v0 differs from v1 in two ways a real migration would handle:
 *   - it carries `version: 0`
 *   - the document title field is named `name`, not `title`
 * The migration renames `name -> title` and stamps `version: 1`.
 */
import type { DocumentMigration } from '../migrations.ts';

/** A v0 document: same as v1 but `version: 0` and `name` instead of `title`. */
export const syntheticV0Document = {
	version: 0,
	name: 'Legacy Quarterly Report',
	sections: [
		{
			id: 'overview',
			title: 'Overview',
			blocks: [{ type: 'text', id: 'intro', paragraphs: [[{ text: 'Carried over from v0.' }]] }]
		}
	]
} as const;

/** The v0 -> v1 step: rename `name` to `title`, set the current version literal. */
export const syntheticV0Migration: DocumentMigration = {
	from: 0,
	to: 1,
	migrate(document) {
		const { name, ...rest } = document as Record<string, unknown> & { name?: unknown };
		delete rest['version'];
		return { ...rest, version: 1, title: name };
	}
};
