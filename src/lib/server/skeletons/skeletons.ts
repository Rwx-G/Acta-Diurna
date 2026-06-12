/**
 * Skeleton service (FR8-11). A skeleton IS a schema-v1 document structure with
 * placeholder bindings - the same `DocumentV1` the renderer and report editor
 * consume, no new schema (story 2.1 Dev Notes).
 *
 * Story 2.1 builds the composer and validates the structure it produces. This
 * service owns the validate-and-shape seam; persistence (a `skeletons` table and
 * the Drizzle write) is story 2.2, which extends `saveSkeleton` to insert the
 * returned structure. The seam is honest: 2.1 validates and hands back the
 * structure; 2.2 adds storage at the marked point below.
 */
import { validateDocument, type DocumentV1 } from '$lib/schema';
import { AppError } from '$lib/server/problem';

/** A composed, validated skeleton ready to persist (2.2). */
export interface SavedSkeleton {
	name: string;
	structure: DocumentV1;
}

/**
 * Validates a composed skeleton structure (validate-on-write, like every
 * document write). Throws a 422 AppError carrying `errors[]` when the structure
 * is invalid (empty section, empty title) so the composer renders each error
 * inline at the offending element - the contract every document write uses.
 *
 * Returns the validated structure. Story 2.2 inserts it into the `skeletons`
 * table here (the document title doubles as the skeleton name) and returns the
 * persisted row id.
 */
export function saveSkeleton(structureInput: unknown): SavedSkeleton {
	const result = validateDocument(structureInput);
	if (!result.ok) {
		throw new AppError({
			status: 422,
			type: '/problems/document-validation',
			title: 'Skeleton validation failed',
			detail:
				result.errors.length === 1
					? '1 validation error found in the skeleton.'
					: `${result.errors.length} validation errors found in the skeleton.`,
			errors: result.errors
		});
	}

	// --- story 2.2 persistence seam ---
	// 2.2 inserts `result.document` into the `skeletons` table (UUIDv7 id, name =
	// title, structure JSONB, schema_version, timestamps) and returns the row id.
	return { name: result.document.title, structure: result.document };
}
