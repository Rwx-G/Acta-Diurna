import { and, desc, eq } from 'drizzle-orm';
import {
	validateDocument,
	validateStoredDocument,
	toProblemDetails,
	type DocumentMigration,
	type DocumentV1,
	type ValidationErrorDetail
} from '$lib/schema';
import { ownerFilter, ownerForInsert, type AuthorScope } from '$lib/server/authors';
import { getDb } from '$lib/server/db/client';
import { uuidv7 } from '$lib/server/db/ids';
import { reports, type ReportRow } from '$lib/server/db/schema';
import { MAX_DOCUMENT_BYTES } from '$lib/editor';
import { AppError } from '$lib/server/problem';

export type ReportStatus = 'draft' | 'published';

/** Full report shape returned by reads and writes. */
export interface Report {
	id: string;
	title: string;
	status: ReportStatus;
	schemaVersion: number;
	/** The authoring draft - always the editable source of truth. */
	document: DocumentV1;
	/** Frozen snapshot served to readers; null until first published (story 1.7). */
	publishedDocument: DocumentV1 | null;
	/** When the current snapshot was taken; null until first published. */
	publishedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

/** List-view projection: what the reports list renders, nothing more. */
export interface ReportSummary {
	id: string;
	title: string;
	status: ReportStatus;
	updatedAt: Date;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Safety ceiling on the report-list query (1.5 performance audit). The list view
 * has no pagination yet; this bounds the query so a deployment that accumulates
 * many reports cannot degrade the dashboard load unboundedly. Real counts sit far
 * below this, so truncation is not reachable in practice - it is a guard, not a
 * page size. Replace with real pagination if the catalogue ever approaches it.
 */
const MAX_REPORTS_LISTED = 500;

function toReport(row: ReportRow): Report {
	return {
		id: row.id,
		title: row.title,
		status: row.status as ReportStatus,
		schemaVersion: row.schemaVersion,
		document: row.document,
		publishedDocument: row.publishedDocument ?? null,
		publishedAt: row.publishedAt ?? null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}

function notFound(): AppError {
	return new AppError({
		status: 404,
		title: 'Report not found',
		type: '/problems/report-not-found'
	});
}

function publishedConflict(detail: string): AppError {
	return new AppError({
		status: 409,
		title: 'Report is published',
		type: '/problems/report-published',
		detail
	});
}

function documentTooLarge(): AppError {
	return new AppError({
		status: 413,
		title: 'Document too large',
		type: '/problems/document-too-large',
		detail: `The report document exceeds the ${Math.floor(MAX_DOCUMENT_BYTES / 1_000_000)} MB size budget.`
	});
}

function reportConflict(): AppError {
	return new AppError({
		status: 409,
		title: 'Report changed concurrently',
		type: '/problems/report-conflict',
		detail: 'The report was modified since you loaded it; reload and reapply your change.'
	});
}

/** 422 carrying the actionable errors[]; same fields as `toProblemDetails` (D9/FR2). */
function validationFailed(errors: ValidationErrorDetail[]): AppError {
	const problem = toProblemDetails(errors);
	return new AppError({
		status: problem.status,
		title: problem.title,
		type: problem.type,
		detail: problem.detail,
		errors: problem.errors
	});
}

async function getRow(id: string, scope: AuthorScope): Promise<ReportRow> {
	// Boundary check: a malformed id is a 404, not a postgres cast error.
	if (!UUID_PATTERN.test(id)) throw notFound();
	// Tenancy filter (story 8.2): in multi mode the owner predicate ANDs into the
	// lookup so a cross-author id misses and raises the SAME 404 - no existence
	// oracle. In single mode `ownerFilter` is undefined and the WHERE is the bare
	// id match, byte-identical to the pre-8.2 query.
	const owner = ownerFilter(scope, reports.ownerId);
	const where = owner ? and(eq(reports.id, id), owner) : eq(reports.id, id);
	const rows = await getDb().select().from(reports).where(where).limit(1);
	if (rows.length === 0) throw notFound();
	return rows[0];
}

/**
 * Loads a report row by id with NO owner scoping - the reader path
 * ({@link getPublishedDocument}) only. A reader is gated by the share, not by
 * authorship, so it must reach the owning author's report. Author surfaces never
 * use this; they go through {@link getRow} with a scope.
 */
async function getRowUnscoped(id: string): Promise<ReportRow> {
	if (!UUID_PATTERN.test(id)) throw notFound();
	const rows = await getDb().select().from(reports).where(eq(reports.id, id)).limit(1);
	if (rows.length === 0) throw notFound();
	return rows[0];
}

function validateOrThrow(input: unknown): DocumentV1 {
	const result = validateDocument(input);
	if (!result.ok) throw validationFailed(result.errors);
	return result.document;
}

/**
 * Drops author-only speaker notes from every section (Story 6.2 privacy). Speaker
 * notes are authored for the presenter and must NEVER reach a reader, so the
 * reader-serving chokepoint ({@link getPublishedDocument}) strips them before the
 * document leaves the server. This is the single boundary every reader path
 * funnels through, so no reader-facing route can ship notes - not the rendered
 * HTML and not the hydration payload. The reader view-model already omits the
 * field; this guarantees the raw document a reader route serializes carries none
 * either. The draft and the stored snapshot keep their notes untouched.
 */
function stripSpeakerNotes(document: DocumentV1): DocumentV1 {
	return {
		...document,
		sections: document.sections.map((section) => {
			if (section.notes === undefined) return section;
			const stripped = { ...section };
			delete stripped.notes;
			return stripped;
		})
	};
}

/**
 * Creates a draft report seeded with the smallest useful document: one section
 * holding one text paragraph the author rewrites (an authoring prompt, not
 * lorem). The starter document goes through `validateDocument` like any other
 * write, so an invalid title surfaces as the same 422.
 */
export async function createReport(title: string, scope: AuthorScope): Promise<Report> {
	const document = validateOrThrow({
		version: 1,
		title,
		sections: [
			{
				id: uuidv7(),
				title: 'Introduction',
				blocks: [
					{
						type: 'text',
						id: uuidv7(),
						paragraphs: [
							[
								{
									text: 'Introduce the report here: what period it covers, what changed, and the one thing the reader should remember.'
								}
							]
						]
					}
				]
			}
		]
	});

	const now = new Date();
	const row: ReportRow = {
		id: uuidv7(),
		title: document.title,
		status: 'draft',
		schemaVersion: document.version,
		document,
		publishedDocument: null,
		publishedAt: null,
		ownerId: ownerForInsert(scope),
		createdAt: now,
		updatedAt: now
	};
	await getDb().insert(reports).values(row);
	return toReport(row);
}

/**
 * Creates a draft report from an arbitrary document (validate-on-write, like
 * `createReport`). The skeleton instantiation path (FR11) seeds the draft with
 * the skeleton's structure here, so a report from a skeleton goes through the
 * same write contract as a blank report - the document, not the seed, is the
 * only difference. The row gets a fresh UUIDv7; the document's own ids are kept.
 */
export async function createReportWithDocument(
	documentInput: unknown,
	scope: AuthorScope
): Promise<Report> {
	const document = validateOrThrow(documentInput);
	const now = new Date();
	const row: ReportRow = {
		id: uuidv7(),
		title: document.title,
		status: 'draft',
		schemaVersion: document.version,
		document,
		publishedDocument: null,
		publishedAt: null,
		ownerId: ownerForInsert(scope),
		createdAt: now,
		updatedAt: now
	};
	await getDb().insert(reports).values(row);
	return toReport(row);
}

/**
 * Duplicates a report to start the next issue (FR10): mints a fresh draft from a
 * deep copy of the source document, regardless of the source's status. The copy
 * goes through `structuredClone` (the same deep-copy the editor uses on load) so
 * the new row never aliases the source document - mutating one leaves the other
 * untouched (the 1.7 snapshot-isolation lesson: no shared mutable reference).
 *
 * The status is forced to `draft` and the publish snapshot is cleared
 * (`publishedDocument`/`publishedAt` null) so duplicating a published report
 * yields an editable draft, never a second published edition. Share links are
 * not carried: shares do not exist until Epic 3, and a fresh report id has none.
 * This stays correct when Epic 3 lands a shares table - duplicate keys only the
 * new report id, so it must never copy share rows from the source.
 */
export async function duplicateReport(id: string, scope: AuthorScope): Promise<Report> {
	const source = await getRow(id, scope);
	const document = structuredClone(source.document);
	const now = new Date();
	const row: ReportRow = {
		id: uuidv7(),
		title: document.title,
		status: 'draft',
		schemaVersion: document.version,
		document,
		publishedDocument: null,
		publishedAt: null,
		// The copy belongs to the duplicating author, never the source's owner (in
		// single mode they are the same implicit author; in multi mode a duplicate
		// only ever happens on a report the author already owns, via the scoped read).
		ownerId: ownerForInsert(scope),
		createdAt: now,
		updatedAt: now
	};
	await getDb().insert(reports).values(row);
	return toReport(row);
}

/** Loads one report; 404 when the id is unknown, malformed, or owned by another author. */
export async function getReport(id: string, scope: AuthorScope): Promise<Report> {
	return toReport(await getRow(id, scope));
}

/**
 * Runs the report-summary list query, optionally filtered by an owner predicate.
 * The owner branch keeps single mode (no predicate) on the EXACT pre-8.2 chain
 * (`from().orderBy().limit()`, no WHERE) so its SQL is byte-identical; the multi
 * branch ANDs the owner WHERE before the order. Same projection, cap, and order
 * either way.
 */
function selectReportSummaries(
	owner: ReturnType<typeof ownerFilter>
): Promise<{ id: string; title: string; status: string; updatedAt: Date }[]> {
	const projection = {
		id: reports.id,
		title: reports.title,
		status: reports.status,
		updatedAt: reports.updatedAt
	};
	if (!owner) {
		return getDb()
			.select(projection)
			.from(reports)
			.orderBy(desc(reports.updatedAt))
			.limit(MAX_REPORTS_LISTED);
	}
	return getDb()
		.select(projection)
		.from(reports)
		.where(owner)
		.orderBy(desc(reports.updatedAt))
		.limit(MAX_REPORTS_LISTED);
}

/**
 * Lists reports for the workspace, most recently updated first, capped at
 * {@link MAX_REPORTS_LISTED}. Projects only the {@link ReportSummary} columns:
 * the two JSONB document columns are large and the list view never reads them,
 * so selecting them on every dashboard load is wasted transfer (1.5 performance
 * audit). The cap is a safety ceiling, not pagination - real counts sit far
 * below it.
 */
export async function listReports(scope: AuthorScope): Promise<ReportSummary[]> {
	const rows = await selectReportSummaries(ownerFilter(scope, reports.ownerId));
	return rows.map((row) => ({
		id: row.id,
		title: row.title,
		status: row.status as ReportStatus,
		updatedAt: row.updatedAt
	}));
}

/**
 * Validates and writes a document onto an already-read draft row, mirroring the
 * title and version onto the row. Shared by `updateReportDocument` and
 * `updateReportTitle` so the read happens exactly once per write. When
 * `expectedUpdatedAt` is given, it joins the WHERE clause and a zero-row update
 * (someone else wrote in between) raises a 409 conflict (optimistic concurrency,
 * AR-style); single-writer callers omit it and the row id alone matches.
 */
async function writeDocument(
	row: ReportRow,
	documentInput: unknown,
	expectedUpdatedAt?: Date
): Promise<Report> {
	if (row.status === 'published') {
		throw publishedConflict('Published reports are read-only.');
	}
	const document = validateOrThrow(documentInput);
	// Size budget enforced at the single write chokepoint, so EVERY writer (save,
	// title update, bind) is bounded - not just the save action's pre-parse
	// guard. A bind that resolves a large data set into the document is rejected
	// here before it reaches JSONB (DoS budget).
	if (JSON.stringify(document).length > MAX_DOCUMENT_BYTES) {
		throw documentTooLarge();
	}
	const updatedAt = new Date();
	const where =
		expectedUpdatedAt === undefined
			? eq(reports.id, row.id)
			: and(eq(reports.id, row.id), eq(reports.updatedAt, expectedUpdatedAt));
	const result = await getDb()
		.update(reports)
		.set({ title: document.title, schemaVersion: document.version, document, updatedAt })
		.where(where);
	if (expectedUpdatedAt !== undefined && result.rowCount === 0) throw reportConflict();
	return toReport({
		...row,
		title: document.title,
		schemaVersion: document.version,
		document,
		updatedAt
	});
}

/**
 * Replaces the document of a draft after validate-on-write (D3). The row title
 * and schema version mirror the document so the list never diverges from the
 * content. Throws 422 with `errors[]` on validation failure, 409 on a
 * published report (publishing makes a report read-only until 1.7 grows the
 * lifecycle). Pass `expectedUpdatedAt` to opt into optimistic concurrency: a
 * concurrent write then yields a 409 `/problems/report-conflict` instead of a
 * silent last-writer-wins overwrite (1.5 is single-writer; Epic 4 opts in).
 */
export async function updateReportDocument(
	id: string,
	documentInput: unknown,
	scope: AuthorScope,
	expectedUpdatedAt?: Date
): Promise<Report> {
	return writeDocument(await getRow(id, scope), documentInput, expectedUpdatedAt);
}

/**
 * Renames a draft. The title lives inside the document (single source of
 * truth), so this rewrites `document.title` and re-validates like any other
 * document write - reading the row once and writing through the shared helper.
 */
export async function updateReportTitle(
	id: string,
	title: string,
	scope: AuthorScope
): Promise<Report> {
	const row = await getRow(id, scope);
	return writeDocument(row, { ...row.document, title });
}

/** Deletes a draft; published reports refuse with 409 (no cascade exists yet). */
export async function deleteDraft(id: string, scope: AuthorScope): Promise<void> {
	const row = await getRow(id, scope);
	if (row.status === 'published') {
		throw publishedConflict('Published reports cannot be deleted.');
	}
	await getDb().delete(reports).where(eq(reports.id, id));
}

function notShareable(): AppError {
	return new AppError({
		status: 409,
		title: 'Report is not published',
		type: '/problems/report-not-published',
		detail: 'Only a published report can be shared.'
	});
}

/**
 * Guards the sharing entry point (FR6): a report is eligible to be shared only
 * once it is published. Throws a 409 otherwise. Exposed now so Epic 3's share
 * service consumes one canonical check; the publish lifecycle owns the rule.
 */
export function assertShareable(report: Pick<Report, 'status'>): void {
	if (report.status !== 'published') throw notShareable();
}

/**
 * Publishes a draft: validates the document (a draft may be invalid, so this is
 * where the 422 surfaces; a published report is never invalid), freezes it into
 * the published snapshot with a publish timestamp, and flips the status. The
 * draft `document` is untouched, so editing after publish evolves the draft
 * while readers keep seeing the snapshot until the next publish.
 *
 * Idempotent: publishing an already-published report is a no-op success - it
 * returns the report unchanged without re-snapshotting (the snapshot is the
 * version that was published, not the latest draft). Pass `expectedUpdatedAt`
 * to opt into optimistic concurrency (a concurrent draft edit then 409s).
 */
export async function publishReport(
	id: string,
	scope: AuthorScope,
	expectedUpdatedAt?: Date
): Promise<Report> {
	const row = await getRow(id, scope);
	if (row.status === 'published') return toReport(row);

	const document = validateOrThrow(row.document);
	const now = new Date();
	const where =
		expectedUpdatedAt === undefined
			? eq(reports.id, row.id)
			: and(eq(reports.id, row.id), eq(reports.updatedAt, expectedUpdatedAt));
	const result = await getDb()
		.update(reports)
		.set({
			status: 'published',
			publishedDocument: document,
			publishedAt: now,
			updatedAt: now
		})
		.where(where);
	if (expectedUpdatedAt !== undefined && result.rowCount === 0) throw reportConflict();
	return toReport({
		...row,
		status: 'published',
		publishedDocument: document,
		publishedAt: now,
		updatedAt: now
	});
}

/**
 * Reverts a published report to draft so it can be edited or deleted again (the
 * 1.5 guards make a published report read-only; unpublishing is the escape
 * hatch). The draft `document` stays authoritative and untouched. The published
 * snapshot is cleared - an unpublished report is not shareable, so no reader
 * should be served a stale frozen copy. Idempotent: a draft is returned as-is.
 */
export async function unpublishToDraft(id: string, scope: AuthorScope): Promise<Report> {
	const row = await getRow(id, scope);
	if (row.status === 'draft') return toReport(row);

	const now = new Date();
	await getDb()
		.update(reports)
		.set({ status: 'draft', publishedDocument: null, publishedAt: null, updatedAt: now })
		.where(eq(reports.id, row.id));
	return toReport({
		...row,
		status: 'draft',
		publishedDocument: null,
		publishedAt: null,
		updatedAt: now
	});
}

/**
 * The document a reader is served (FR6/FR7): the frozen published snapshot,
 * migrated to the current schema and validated through the render-path contract
 * ({@link validateStoredDocument}). Throws 409 when the report is not published
 * (no snapshot to serve) and 422 if a snapshot ever fails to validate (an
 * unsupported version names the supported range). Epic 3's `/r/[token]` reader
 * consumes this so the gating lives in the service, not the route.
 *
 * Distinct from the author `/view`, which renders the live DRAFT for preview.
 *
 * `migrations` is injectable for tests, matching {@link validateStoredDocument}.
 */
export async function getPublishedDocument(
	id: string,
	migrations?: readonly DocumentMigration[]
): Promise<DocumentV1> {
	// The READER path (`/r/[token]`), NOT an author surface: a verified reader
	// resolved a share to this report id and is served its published snapshot. The
	// reader does not act as an author, so this read is NOT owner-scoped - the
	// share is the access gate, and a published report is the same content for every
	// authorized reader regardless of which author owns it.
	const row = await getRowUnscoped(id);
	if (row.status !== 'published' || row.publishedDocument === null) throw notShareable();
	// The snapshot was validated at publish time, yet it is migrated-then-validated
	// again here on every read. This is the FR7 version-tolerance path, not dead
	// code: a snapshot frozen under schema v(N-1) is lifted to the current shape
	// and re-validated so it still renders after a schema upgrade. This is the
	// migration entry point Epic 3's reader (`/r/[token]`) consumes.
	const result = validateStoredDocument(row.publishedDocument, migrations);
	if (!result.ok) throw validationFailed(result.errors);
	// Author-only speaker notes never leave the server on a reader path (Story 6.2).
	return stripSpeakerNotes(result.document);
}
