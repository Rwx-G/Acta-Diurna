/**
 * Skeleton service (FR8-11). A skeleton IS a schema-v1 document structure with
 * placeholder bindings - the same `DocumentV1` the renderer and report editor
 * consume, no new schema (story 2.1 Dev Notes). Story 2.1 built the composer and
 * validated the structure; story 2.2 persists it to the `skeletons` table and
 * grows the library + instantiation operations.
 *
 * Validate-on-write throughout, like every document write: a structure crosses
 * into storage only after `validateDocument`, and instantiation reuses the
 * reports `createReportWithDocument` path so a report from a skeleton goes
 * through the same write contract as a blank report - only the seed differs.
 */
import { and, desc, eq } from 'drizzle-orm';
import { validateDocument, type DocumentV1 } from '$lib/schema';
import { ownerFilter, ownerForInsert, type AuthorScope } from '$lib/server/authors';
import { getDb } from '$lib/server/db/client';
import { UUID_PATTERN, uuidv7 } from '$lib/server/db/ids';
import { skeletons, type SkeletonRow } from '$lib/server/db/schema';
import { createReportWithDocument, type Report } from '$lib/server/documents/reports';
import { AppError } from '$lib/server/problem';

/** A persisted skeleton. The document title doubles as the unique library name. */
export interface Skeleton {
	id: string;
	name: string;
	schemaVersion: number;
	document: DocumentV1;
	createdAt: Date;
	updatedAt: Date;
}

/** Library list projection: what the skeleton library renders, nothing more. */
export interface SkeletonSummary {
	id: string;
	name: string;
	updatedAt: Date;
}

/** Postgres unique_violation; a duplicate skeleton name trips `skeletons_owner_id_name_idx`. */
const UNIQUE_VIOLATION = '23505';

function toSkeleton(row: SkeletonRow): Skeleton {
	return {
		id: row.id,
		name: row.name,
		schemaVersion: row.schemaVersion,
		document: row.document,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}

function notFound(): AppError {
	return new AppError({
		status: 404,
		title: 'Skeleton not found',
		type: '/problems/skeleton-not-found'
	});
}

function nameTaken(name: string): AppError {
	return new AppError({
		status: 409,
		title: 'Skeleton name already in use',
		type: '/problems/skeleton-name-taken',
		detail: `A skeleton named "${name}" already exists. Choose a distinct name.`
	});
}

function isUniqueViolation(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		(error as { code: unknown }).code === UNIQUE_VIOLATION
	);
}

/**
 * Validates a composed skeleton structure (validate-on-write) and persists it.
 * Throws a 422 AppError carrying `errors[]` when the structure is invalid (empty
 * section, empty title) so the composer renders each error inline at the
 * offending element. A name already in library raises a 409
 * `/problems/skeleton-name-taken` (the unique index is the source of truth; the
 * pg unique violation is caught and translated). Returns the persisted skeleton.
 */
export async function saveSkeleton(structureInput: unknown, scope: AuthorScope): Promise<Skeleton> {
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

	const document = result.document;
	const now = new Date();
	const row: SkeletonRow = {
		id: uuidv7(),
		name: document.title,
		schemaVersion: document.version,
		document,
		ownerId: ownerForInsert(scope),
		createdAt: now,
		updatedAt: now
	};
	try {
		await getDb().insert(skeletons).values(row);
	} catch (error) {
		if (isUniqueViolation(error)) throw nameTaken(document.title);
		throw error;
	}
	return toSkeleton(row);
}

/** Lists the owner-scoped skeleton library, most recently updated first (FR9). In
 *  single mode the owner predicate is a no-op (byte-identical to the pre-8.2 query);
 *  in multi mode another author's skeletons are invisible. */
export async function listSkeletons(scope: AuthorScope): Promise<SkeletonSummary[]> {
	const owner = ownerFilter(scope, skeletons.ownerId);
	const base = getDb().select().from(skeletons);
	const rows = await (owner ? base.where(owner) : base).orderBy(desc(skeletons.updatedAt));
	return rows.map((row) => ({ id: row.id, name: row.name, updatedAt: row.updatedAt }));
}

/**
 * Loads one skeleton; 404 when the id is unknown, malformed, or owned by another
 * author. The owner predicate ANDs into the lookup (multi mode) so a cross-author
 * id raises the SAME 404 - no existence oracle. In single mode the predicate is
 * undefined and the WHERE is the bare id match, byte-identical to the pre-8.2 query.
 */
export async function getSkeleton(id: string, scope: AuthorScope): Promise<Skeleton> {
	// Boundary check: a malformed id is a 404, not a postgres cast error.
	if (!UUID_PATTERN.test(id)) throw notFound();
	const owner = ownerFilter(scope, skeletons.ownerId);
	const where = owner ? and(eq(skeletons.id, id), owner) : eq(skeletons.id, id);
	const rows = await getDb().select().from(skeletons).where(where).limit(1);
	if (rows.length === 0) throw notFound();
	return toSkeleton(rows[0]);
}

/** Deletes a skeleton by id; 404 when unknown, malformed, or owned by another
 *  author (the scoped read is the gate). No cascade exists. */
export async function deleteSkeleton(id: string, scope: AuthorScope): Promise<void> {
	await getSkeleton(id, scope);
	await getDb().delete(skeletons).where(eq(skeletons.id, id));
}

/**
 * Creates a draft report from a saved skeleton (FR11): the report's sections,
 * blocks, and bindings mirror the skeleton's structure exactly. Instantiation
 * reuses the reports `createReportWithDocument` write path with the skeleton
 * document as the seed, so two reports from one skeleton are structurally
 * identical (the skeleton's own ids and structure are copied verbatim). 404 when
 * the skeleton id is unknown.
 */
export async function instantiateReport(skeletonId: string, scope: AuthorScope): Promise<Report> {
	const skeleton = await getSkeleton(skeletonId, scope);
	return createReportWithDocument(skeleton.document, scope);
}
