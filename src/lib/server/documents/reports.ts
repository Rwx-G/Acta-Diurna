import { and, desc, eq } from 'drizzle-orm';
import {
	validateDocument,
	toProblemDetails,
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
	document: DocumentV1;
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
