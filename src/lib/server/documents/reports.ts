import { and, desc, eq } from 'drizzle-orm';
import {
	validateDocument,
	validateStoredDocument,
	toProblemDetails,
	type DocumentMigration,
	type DocumentV1,
	type ValidationErrorDetail
} from '$lib/schema';
import { getDb } from '$lib/server/db/client';
import { uuidv7 } from '$lib/server/db/ids';
import { reports, type ReportRow } from '$lib/server/db/schema';
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

async function getRow(id: string): Promise<ReportRow> {
	// Boundary check: a malformed id is a 404, not a postgres cast error.
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
 * Creates a draft report seeded with the smallest useful document: one section
 * holding one text paragraph the author rewrites (an authoring prompt, not
 * lorem). The starter document goes through `validateDocument` like any other
 * write, so an invalid title surfaces as the same 422.
 */
export async function createReport(title: string): Promise<Report> {
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
		createdAt: now,
		updatedAt: now
	};
	await getDb().insert(reports).values(row);
	return toReport(row);
}

/** Loads one report; 404 when the id is unknown or malformed. */
export async function getReport(id: string): Promise<Report> {
	return toReport(await getRow(id));
}

/** Lists all reports for the workspace, most recently updated first. */
export async function listReports(): Promise<ReportSummary[]> {
	const rows = await getDb().select().from(reports).orderBy(desc(reports.updatedAt));
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
	expectedUpdatedAt?: Date
): Promise<Report> {
	return writeDocument(await getRow(id), documentInput, expectedUpdatedAt);
}

/**
 * Renames a draft. The title lives inside the document (single source of
 * truth), so this rewrites `document.title` and re-validates like any other
 * document write - reading the row once and writing through the shared helper.
 */
export async function updateReportTitle(id: string, title: string): Promise<Report> {
	const row = await getRow(id);
	return writeDocument(row, { ...row.document, title });
}

/** Deletes a draft; published reports refuse with 409 (no cascade exists yet). */
export async function deleteDraft(id: string): Promise<void> {
	const row = await getRow(id);
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
export async function publishReport(id: string, expectedUpdatedAt?: Date): Promise<Report> {
	const row = await getRow(id);
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
export async function unpublishToDraft(id: string): Promise<Report> {
	const row = await getRow(id);
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
	const row = await getRow(id);
	if (row.status !== 'published' || row.publishedDocument === null) throw notShareable();
	// The snapshot was validated at publish time, yet it is migrated-then-validated
	// again here on every read. This is the FR7 version-tolerance path, not dead
	// code: a snapshot frozen under schema v(N-1) is lifted to the current shape
	// and re-validated so it still renders after a schema upgrade. This is the
	// migration entry point Epic 3's reader (`/r/[token]`) consumes.
	const result = validateStoredDocument(row.publishedDocument, migrations);
	if (!result.ok) throw validationFailed(result.errors);
	return result.document;
}
