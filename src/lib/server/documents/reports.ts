import { and, asc, desc, eq, type SQL } from 'drizzle-orm';
import {
	diffSnapshots,
	validateDocument,
	validateStoredDocument,
	toProblemDetails,
	type DocumentMigration,
	type DocumentV1,
	type SeriesDiff,
	type ValidationErrorDetail
} from '$lib/schema';
import { ownerFilter, ownerForInsert, type AuthorScope } from '$lib/server/authors';
import { getDb } from '$lib/server/db/client';
import {
	applyOwnerScopedFilters,
	cursorPredicate,
	decodeCursor,
	pageSize,
	toPage,
	type Page,
	type PageRequest
} from '$lib/server/db/cursor';
import { UUID_PATTERN, uuidv7 } from '$lib/server/db/ids';
import { reportSeries, reports, type ReportRow } from '$lib/server/db/schema';
import { MAX_DOCUMENT_BYTES } from '$lib/editor';
import { logger } from '$lib/server/logger';
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
	/** The series (lineage) this issue belongs to (story 9.1); null only on a pre-backfill row. */
	seriesId: string | null;
	/** The issue this one was duplicated from (story 9.1); null for the first issue of a series. */
	predecessorId: string | null;
	/** An optional author-set display label for the issue (story 9.1); cosmetic, never an ordering key. */
	issueLabel: string | null;
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

function toReport(row: ReportRow): Report {
	return {
		id: row.id,
		title: row.title,
		status: row.status as ReportStatus,
		schemaVersion: row.schemaVersion,
		document: row.document,
		publishedDocument: row.publishedDocument ?? null,
		publishedAt: row.publishedAt ?? null,
		seriesId: row.seriesId ?? null,
		predecessorId: row.predecessorId ?? null,
		issueLabel: row.issueLabel ?? null,
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

/**
 * The owner-scoped id-lookup WHERE (story 8.2). In multi mode the owner predicate
 * ANDs into the lookup so a cross-author id misses and raises the SAME 404 - no
 * existence oracle. In single mode `ownerFilter` is undefined and the WHERE is the
 * bare id match, byte-identical to the pre-8.2 query. Shared by every scoped read
 * regardless of which projection it pulls.
 */
function scopedWhere(id: string, scope: AuthorScope): SQL {
	const owner = ownerFilter(scope, reports.ownerId);
	return owner ? and(eq(reports.id, id), owner)! : eq(reports.id, id);
}

/**
 * Loads the FULL report row by id (both JSONB document columns), for the paths
 * that genuinely read the draft `document` or return a full {@link Report}
 * ({@link getReport}, {@link duplicateReport}, the update/publish paths). The
 * status-only and reader paths use the narrow projections below so they never
 * pull both heavy JSONB columns (3.x performance audit, E1).
 */
async function getRow(id: string, scope: AuthorScope): Promise<ReportRow> {
	// Boundary check: a malformed id is a 404, not a postgres cast error.
	if (!UUID_PATTERN.test(id)) throw notFound();
	const rows = await getDb().select().from(reports).where(scopedWhere(id, scope)).limit(1);
	if (rows.length === 0) throw notFound();
	return rows[0];
}

/** Status/metadata projection: what a status-only check needs, no JSONB document column. */
type ReportMetaRow = { id: string; status: string };

const metaProjection = { id: reports.id, status: reports.status };

/**
 * Loads only the metadata a status/ownership check needs - id and status - with
 * NEITHER heavy JSONB column. Used by the listability/status paths
 * ({@link deleteDraft}) so a status check never transfers the draft document or
 * the published snapshot (3.x performance audit, E1). Owner-scoped like
 * {@link getRow}: a cross-author id is the same 404.
 */
async function getMetaRow(id: string, scope: AuthorScope): Promise<ReportMetaRow> {
	if (!UUID_PATTERN.test(id)) throw notFound();
	const rows = await getDb()
		.select(metaProjection)
		.from(reports)
		.where(scopedWhere(id, scope))
		.limit(1);
	if (rows.length === 0) throw notFound();
	return rows[0];
}

/**
 * Diff-snapshot projection: the columns the diff reads - id, status, the published
 * snapshot, and the predecessor edge - with NO draft `document` column. The diff
 * compares two FROZEN editions, so it never needs the editable draft; pulling it on
 * both reads (the issue and its predecessor) would transfer a heavy JSONB column
 * for nothing (3.x performance audit, E1, the same projection discipline the reader
 * and status paths follow).
 */
type ReportDiffRow = {
	id: string;
	status: string;
	publishedDocument: DocumentV1 | null;
	predecessorId: string | null;
};

const diffSnapshotProjection = {
	id: reports.id,
	status: reports.status,
	publishedDocument: reports.publishedDocument,
	predecessorId: reports.predecessorId
};

/**
 * Loads the diff-snapshot projection by id, owner-scoped like {@link getRow}: a
 * cross-author, unknown, or malformed id is the same neutral 404 the tenancy layer
 * uses, so a diff never spans authors. Pulls only the four columns the diff needs,
 * never the draft `document` (E1).
 */
async function getDiffSnapshotRow(id: string, scope: AuthorScope): Promise<ReportDiffRow> {
	if (!UUID_PATTERN.test(id)) throw notFound();
	const rows = await getDb()
		.select(diffSnapshotProjection)
		.from(reports)
		.where(scopedWhere(id, scope))
		.limit(1);
	if (rows.length === 0) throw notFound();
	return rows[0];
}

/** Reader projection: the published snapshot, status, and id - the only columns the reader serves. */
type ReportReaderRow = { id: string; status: string; publishedDocument: DocumentV1 | null };

const readerProjection = {
	id: reports.id,
	status: reports.status,
	publishedDocument: reports.publishedDocument
};

/**
 * Loads the READER projection by id with NO owner scoping - the reader path
 * ({@link getPublishedDocument}) only. A reader is gated by the share, not by
 * authorship, so it must reach the owning author's report. Pulls only the
 * published snapshot, status, and id (NOT the draft `document` the reader never
 * serves), so a reader read never transfers the editable draft (3.x performance
 * audit, E1). Author surfaces never use this; they go through {@link getRow}.
 */
async function getReaderRow(id: string): Promise<ReportReaderRow> {
	if (!UUID_PATTERN.test(id)) throw notFound();
	const rows = await getDb()
		.select(readerProjection)
		.from(reports)
		.where(eq(reports.id, id))
		.limit(1);
	if (rows.length === 0) throw notFound();
	return rows[0];
}

/**
 * The db handle OR a transaction handle. The create/duplicate paths run their
 * series + report writes inside `db.transaction`, so the series/report inserts take
 * the transaction's executor (`tx`) instead of the pooled db - the multi-statement
 * sequence then commits atomically (a crash mid-sequence leaves no dangling series
 * row or half-formed lineage). A standalone call passes the db itself.
 */
type DbExecutor = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/**
 * Mints a fresh series owned by the current author and returns its id (story
 * 9.1). A report that is created fresh (not by duplication) starts its OWN series
 * with a null predecessor, so a never-duplicated report is a one-issue series, not
 * a null - the same `ownerForInsert` the report carries, so the series is
 * owner-consistent with its first issue by construction. Takes the executor so the
 * insert joins the caller's transaction (atomic series + report).
 */
async function createSeries(executor: DbExecutor, scope: AuthorScope): Promise<string> {
	const id = uuidv7();
	await executor.insert(reportSeries).values({ id, ownerId: ownerForInsert(scope) });
	return id;
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
	// A fresh report starts its own one-issue series with a null predecessor (AC3).
	// The series + report inserts run in one transaction so a crash between them
	// never leaves a dangling series row.
	const row = await getDb().transaction(async (tx) => {
		const seriesId = await createSeries(tx, scope);
		const newRow: ReportRow = {
			id: uuidv7(),
			title: document.title,
			status: 'draft',
			schemaVersion: document.version,
			document,
			publishedDocument: null,
			publishedAt: null,
			ownerId: ownerForInsert(scope),
			seriesId,
			predecessorId: null,
			issueLabel: null,
			createdAt: now,
			updatedAt: now
		};
		await tx.insert(reports).values(newRow);
		return newRow;
	});
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
	// A fresh report starts its own one-issue series with a null predecessor (AC3).
	// The series + report inserts run in one transaction so a crash between them
	// never leaves a dangling series row.
	const row = await getDb().transaction(async (tx) => {
		const seriesId = await createSeries(tx, scope);
		const newRow: ReportRow = {
			id: uuidv7(),
			title: document.title,
			status: 'draft',
			schemaVersion: document.version,
			document,
			publishedDocument: null,
			publishedAt: null,
			ownerId: ownerForInsert(scope),
			seriesId,
			predecessorId: null,
			issueLabel: null,
			createdAt: now,
			updatedAt: now
		};
		await tx.insert(reports).values(newRow);
		return newRow;
	});
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
 *
 * Series lineage (Epic 9, story 9.1): this IS the "start the next issue" motion,
 * so it records the lineage edge - the only addition over the duplicate semantics
 * above. The new draft sets `predecessor_id` to the source and inherits the
 * source's `series_id`; if the source carries no series yet (only a legacy
 * pre-backfill row would, since every live report gets a series on create), one
 * is established and assigned to the source FIRST, so the source and the new issue
 * always share a lineage. Owner-scoped by construction: the scoped `getRow`
 * already proved the source belongs to the duplicating author, the new series (if
 * minted) carries that author, and the new report carries that author - a series
 * never spans authors. In single mode this is the implicit author throughout.
 */
export async function duplicateReport(id: string, scope: AuthorScope): Promise<Report> {
	const source = await getRow(id, scope);
	const document = structuredClone(source.document);
	const now = new Date();
	// The whole lineage edge commits atomically: minting a series for a legacy source,
	// backfilling it onto the source, and inserting the copy run in one transaction so
	// a crash mid-sequence never leaves a dangling series row or a source/copy split
	// across two lineages.
	const row = await getDb().transaction(async (tx) => {
		// Inherit the source's series; establish one for a legacy source with none, and
		// backfill the source onto it so the predecessor and its copy share the lineage.
		let seriesId = source.seriesId;
		if (seriesId === null) {
			seriesId = await createSeries(tx, scope);
			await tx.update(reports).set({ seriesId }).where(eq(reports.id, source.id));
		}
		const newRow: ReportRow = {
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
			seriesId,
			predecessorId: source.id,
			issueLabel: null,
			createdAt: now,
			updatedAt: now
		};
		await tx.insert(reports).values(newRow);
		return newRow;
	});
	return toReport(row);
}

/** Loads one report; 404 when the id is unknown, malformed, or owned by another author. */
export async function getReport(id: string, scope: AuthorScope): Promise<Report> {
	return toReport(await getRow(id, scope));
}

/**
 * One issue of a series, in the ordered-lineage projection (story 9.1): the
 * metadata the navigation/diff stories (9.2/9.3) consume, with NEITHER heavy JSONB
 * document column. `predecessorId` is carried so a consumer can verify the chain.
 */
export interface SeriesIssue {
	id: string;
	title: string;
	status: ReportStatus;
	predecessorId: string | null;
	issueLabel: string | null;
	publishedAt: Date | null;
	updatedAt: Date;
}

const seriesIssueProjection = {
	id: reports.id,
	title: reports.title,
	status: reports.status,
	predecessorId: reports.predecessorId,
	issueLabel: reports.issueLabel,
	publishedAt: reports.publishedAt,
	updatedAt: reports.updatedAt
};

/**
 * Orders the issues of a series by the PREDECESSOR CHAIN (story 9.1): issue N's
 * predecessor is issue N-1, so a back-dated or out-of-order republish never
 * reshuffles the series - `published_at` is a display label, NOT the ordering key.
 *
 * The chain is rebuilt in memory from the issue set: the head is the issue whose
 * predecessor is null (or whose predecessor is outside this series - a defensive
 * fallback for a hand-edited link), then each successor is the issue pointing back
 * at the current one. A cycle or a fork (two issues sharing one predecessor) is
 * impossible by construction (the edge is only ever set by `duplicateReport` to an
 * existing issue, never re-pointed). Defensively, though, a corrupted edge is
 * handled WITHOUT silent loss: the successor index is `predecessor -> issue[]`, so a
 * fork keeps EVERY branch (a `Map<key, issue>` would let the second sibling overwrite
 * and silently drop the first, poisoning the 9.2 diff). Siblings are walked in the
 * input order (the issues query orders by `created_at, id`, so the order is
 * deterministic), a fork is `logger.warn`-ed so a corrupted edge is observable, and
 * the walk is bounded by the issue count (the `seen` set stops a repeat) so a cycle
 * degrades to a truncated list, never a hang. Any issue the walk never reaches is
 * appended in input order, so no issue is ever dropped.
 */
function orderByPredecessorChain(issues: SeriesIssue[]): SeriesIssue[] {
	const byId = new Map(issues.map((issue) => [issue.id, issue]));
	const successorsOf = new Map<string | null, SeriesIssue[]>();
	for (const issue of issues) {
		const key =
			issue.predecessorId !== null && byId.has(issue.predecessorId) ? issue.predecessorId : null;
		const siblings = successorsOf.get(key);
		if (siblings === undefined) {
			successorsOf.set(key, [issue]);
		} else {
			siblings.push(issue);
			logger.warn(
				{ predecessorId: key, issues: siblings.map((sibling) => sibling.id) },
				'forked report series: two issues share a predecessor; ordering keeps every branch'
			);
		}
	}
	const ordered: SeriesIssue[] = [];
	const seen = new Set<string>();
	// Depth-first from the head(s), walking every branch of a fork in input order. A
	// stack of the not-yet-visited successors keeps the well-formed single chain in
	// order while still covering each branch of a corrupted fork exactly once.
	const stack = [...(successorsOf.get(null) ?? [])].reverse();
	while (stack.length > 0) {
		const current = stack.pop()!;
		if (seen.has(current.id)) continue;
		ordered.push(current);
		seen.add(current.id);
		const successors = successorsOf.get(current.id) ?? [];
		for (let i = successors.length - 1; i >= 0; i--) stack.push(successors[i]);
	}
	// Any issue the walk did not reach (an orphaned edge or a cycle with no null head)
	// is appended in input order so it is never silently dropped.
	for (const issue of issues) {
		if (!seen.has(issue.id)) ordered.push(issue);
	}
	return ordered;
}

/**
 * Lists the issues of a series ordered by the predecessor chain (story 9.1), the
 * read the diff/navigation stories (9.2/9.3) consume. Owner-scoped: the series id
 * is matched under the owner predicate, so a cross-author (or unknown, or
 * malformed) series id returns the same neutral 404 the rest of the tenancy layer
 * uses - no existence oracle. In single mode the implicit author owns every series,
 * so the predicate is a no-op. Pulls the metadata projection only, never the JSONB
 * document columns (E1).
 */
export async function listSeriesIssues(
	seriesId: string,
	scope: AuthorScope
): Promise<SeriesIssue[]> {
	if (!UUID_PATTERN.test(seriesId)) throw notFound();
	// The owner predicate is applied to the SERIES, the lineage's owner of record;
	// every issue of an owner-consistent series shares that owner by construction.
	const owner = ownerFilter(scope, reportSeries.ownerId);
	const seriesWhere = owner
		? and(eq(reportSeries.id, seriesId), owner)!
		: eq(reportSeries.id, seriesId);
	const seriesRows = await getDb()
		.select({ id: reportSeries.id })
		.from(reportSeries)
		.where(seriesWhere)
		.limit(1);
	if (seriesRows.length === 0) throw notFound();

	// Belt-and-braces: the owner predicate ANDs into the ISSUES query too, not only
	// the series lookup above. The "series owner == issue owner" invariant holds by
	// construction, but a foreign-owned issue (a corrupted row) must never leak just
	// because it carries an owned series id. Single mode: the predicate is undefined,
	// so the WHERE stays the bare `series_id` match, byte-identical to before.
	const issueOwner = ownerFilter(scope, reports.ownerId);
	const issuesWhere = issueOwner
		? and(eq(reports.seriesId, seriesId), issueOwner)!
		: eq(reports.seriesId, seriesId);
	const issueRows = await getDb()
		.select(seriesIssueProjection)
		.from(reports)
		.where(issuesWhere)
		// A SQL order is deferred to the in-memory predecessor-chain walk
		// (`orderByPredecessorChain`); `created_at, id` only fixes a DETERMINISTIC
		// input order (fork-branch tie-break), it is never the displayed order.
		.orderBy(asc(reports.createdAt), asc(reports.id))
		// A series past this is pathological (a thousand-issue lineage). The cap bounds
		// the read; the chain walk already tolerates a truncated set (an unreached issue
		// is appended, never dropped), so truncation degrades gracefully.
		.limit(1000);
	const issues = issueRows.map((row) => ({
		id: row.id,
		title: row.title,
		status: row.status as ReportStatus,
		predecessorId: row.predecessorId ?? null,
		issueLabel: row.issueLabel ?? null,
		publishedAt: row.publishedAt ?? null,
		updatedAt: row.updatedAt
	}));
	return orderByPredecessorChain(issues);
}

/**
 * Runs the report-summary list query for one page, optionally filtered by an owner
 * predicate. Single mode with NO cursor keeps the EXACT pre-8.2 chain
 * (`from().orderBy().limit()`, no WHERE) so its SQL is byte-identical; the owner
 * predicate (multi mode) and the keyset predicate (a cursor) AND into the WHERE
 * when present. Same projection and order either way. Fetches `limit + 1` so the
 * caller can detect a further page.
 */
function selectReportSummaries(
	owner: ReturnType<typeof ownerFilter>,
	keyset: SQL | undefined,
	limit: number
): Promise<{ id: string; title: string; status: string; updatedAt: Date }[]> {
	const projection = {
		id: reports.id,
		title: reports.title,
		status: reports.status,
		updatedAt: reports.updatedAt
	};
	const query = applyOwnerScopedFilters(getDb().select(projection).from(reports).$dynamic(), [
		owner,
		keyset
	]);
	return query.orderBy(desc(reports.updatedAt), desc(reports.id)).limit(limit + 1);
}

/**
 * Lists a page of reports for the workspace, most recently updated first, with
 * keyset (cursor) pagination ({@link Page}). Projects only the {@link ReportSummary}
 * columns: the two JSONB document columns are large and the list view never reads
 * them, so selecting them on every dashboard load is wasted transfer (1.5
 * performance audit). The keyset is `(updated_at DESC, id DESC)`; an absent cursor
 * starts from the newest. Fetching `limit + 1` sets `nextCursor` so a caller (the
 * REST list, the MCP `list_reports` tool) can page instead of hitting a silent cap
 * (full-audit C2). The owner predicate keeps single mode byte-identical.
 */
export async function listReports(
	scope: AuthorScope,
	page: PageRequest = {}
): Promise<Page<ReportSummary>> {
	const limit = pageSize(page.limit);
	const keyset = cursorPredicate(decodeCursor(page.cursor), reports.updatedAt, reports.id);
	const rows = await selectReportSummaries(ownerFilter(scope, reports.ownerId), keyset, limit);
	const summaries = rows.map((row) => ({
		id: row.id,
		title: row.title,
		status: row.status as ReportStatus,
		updatedAt: row.updatedAt
	}));
	return toPage(summaries, limit, (row) => ({ timestamp: row.updatedAt, id: row.id }));
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
	// Status-only check: the metadata projection avoids pulling either JSONB
	// document column just to gate the delete (E1).
	const row = await getMetaRow(id, scope);
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
 * The 409 raised when a DIFF is requested on an unpublished issue. Same status and
 * problem type as {@link notShareable} (both say "publish first"), but a
 * diff-appropriate detail: a diff compares two frozen editions, so it is not about
 * sharing. Keeping the two factories distinct lets the message track the surface
 * the user is on without overloading the sharing copy onto the diff path.
 */
function notPublished(): AppError {
	return new AppError({
		status: 409,
		title: 'Report is not published',
		type: '/problems/report-not-published',
		detail: 'A diff requires a published snapshot; publish the report first.'
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
	const row = await getReaderRow(id);
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

/**
 * The published snapshot of an owner-scoped row, validated through the same
 * migrate-then-validate render-path contract `getPublishedDocument` uses, or null
 * when the row carries no published snapshot (never published, or unpublished).
 * Unlike `getPublishedDocument`, this reads an ALREADY owner-scoped row (the diff
 * is an AUTHOR surface, not the share-gated reader path), so it is the scoped twin
 * used to resolve the two editions a diff compares. Notes are NOT stripped here:
 * this is an author-owned read, and the diff engine never ships prior-issue data
 * to a reader (a later opt-in story gates any reader exposure).
 */
function publishedSnapshotOf(
	row: Pick<ReportRow, 'status' | 'publishedDocument'>,
	migrations?: readonly DocumentMigration[]
): DocumentV1 | null {
	if (row.status !== 'published' || row.publishedDocument === null) return null;
	const result = validateStoredDocument(row.publishedDocument, migrations);
	if (!result.ok) throw validationFailed(result.errors);
	return result.document;
}

/**
 * Diffs a published issue against its published predecessor in the same series
 * (story 9.2), returning the typed {@link SeriesDiff} the workspace "what changed"
 * view (9.3) and the optional reader summary (9.5) consume. This is the
 * OWNER-SCOPED wiring around the pure {@link diffSnapshots} engine: the engine
 * compares two documents and is side-effect-free; THIS function resolves the two
 * published snapshots under one {@link AuthorScope} and feeds them in.
 *
 * Both reads go through the scoped `getRow`, so a cross-author, unknown, or
 * malformed issue id is the same neutral 404 the rest of the tenancy layer uses -
 * a diff never spans authors (the series is owner-consistent by construction, but
 * the predecessor is independently re-scoped, so a hand-corrupted `predecessor_id`
 * pointing at a foreign report still 404s rather than leaking it). In single mode
 * the implicit author owns everything, so the predicate is a no-op.
 *
 * The issue itself must be published (a diff compares two frozen editions, so an
 * unpublished issue has no edition to compare) - a draft issue throws the same 409
 * not-published `getPublishedDocument` raises. The PREDECESSOR being absent (the
 * first issue) or unpublished yields a neutral `no-predecessor` result, never an
 * error: the engine is handed a null old snapshot. A genuinely different
 * predecessor (a corrupted series link, a rebuilt issue) degrades to the engine's
 * neutral `substantial-drift` verdict.
 *
 * `migrations` is injectable for tests, matching `getPublishedDocument` / the
 * `validateStoredDocument` contract: a snapshot frozen under an earlier schema
 * version is lifted to the current shape before the diff runs.
 *
 * Both reads use the narrow {@link getDiffSnapshotRow} projection (id, status, the
 * published snapshot, the predecessor edge), so the diff never transfers the draft
 * `document` column it does not read (E1).
 *
 * @throws {AppError} 404 when the issue OR its predecessor id is cross-author,
 * unknown, or malformed; 409 not-published when the issue itself is unpublished;
 * 422 when a stored snapshot fails to validate after migration (the
 * `validateStoredDocument` render-path contract, via {@link publishedSnapshotOf}).
 */
export async function diffSeriesIssue(
	id: string,
	scope: AuthorScope,
	migrations?: readonly DocumentMigration[]
): Promise<SeriesDiff> {
	const issueRow = await getDiffSnapshotRow(id, scope);
	const newSnapshot = publishedSnapshotOf(issueRow, migrations);
	if (newSnapshot === null) throw notPublished();

	// No predecessor edge: the first issue of the series. The engine returns the
	// neutral no-predecessor result tagged `first-issue`, so the caller renders
	// "first issue, nothing to compare" without a special-case here.
	if (issueRow.predecessorId === null) {
		return diffSnapshots(newSnapshot, null, 'first-issue');
	}

	// The predecessor is re-resolved under the SAME scope: a foreign or unknown
	// predecessor is the neutral 404, and an unpublished predecessor (no snapshot)
	// is handed to the engine as a null old snapshot -> the no-predecessor verdict,
	// tagged `predecessor-unpublished` so 9.5 can message it apart from a first issue.
	const predecessorRow = await getDiffSnapshotRow(issueRow.predecessorId, scope);
	const oldSnapshot = publishedSnapshotOf(predecessorRow, migrations);
	return diffSnapshots(newSnapshot, oldSnapshot, 'predecessor-unpublished');
}

/**
 * The predecessor's display identity (story 9.3, AC4): the comparison baseline a
 * "what changed" view labels its diff with. Carries the predecessor's title and its
 * COSMETIC display labels (`issueLabel`, `publishedAt`) only - never a document
 * column, never a block body. A diff result has no baseline (a first issue, an
 * unpublished predecessor, or a substantial-drift pair), so this is `null` there.
 */
export interface SeriesDiffBaseline {
	title: string;
	issueLabel: string | null;
	publishedAt: Date | null;
}

/**
 * The owner-scoped payload the workspace "what changed" view (story 9.3) loads: the
 * typed {@link SeriesDiff} from {@link diffSeriesIssue} plus the predecessor's
 * display baseline ({@link SeriesDiffBaseline}) so the view can label the comparison
 * ("vs. June board pack, published 2026-06-07"). The diff carries ONLY structural /
 * data / content CHANGE FLAGS and section/block ids, titles, and types - no notes,
 * no prior-issue block bodies; the baseline carries only the predecessor's cosmetic
 * labels. Nothing author-private and no raw prior-issue content crosses this seam.
 */
export interface SeriesDiffView {
	diff: SeriesDiff;
	/** The predecessor's display baseline, or null when the diff has no predecessor to label. */
	baseline: SeriesDiffBaseline | null;
}

/**
 * Composes the workspace "what changed since last issue" payload (story 9.3): the
 * {@link diffSeriesIssue} result for `id` plus the predecessor's display baseline,
 * all resolved under ONE {@link AuthorScope}. The diff is the authoritative engine
 * output (the same one 9.5 will consume); the baseline is the predecessor's row in
 * the owner-scoped ordered series ({@link listSeriesIssues}), so it is reachable only
 * to the owning author - a cross-author or unknown id is the same neutral 404 the
 * diff itself raises, never an existence oracle.
 *
 * The baseline is present ONLY for a computed `diff` (the AC's "comparison baseline
 * label"). A `no-predecessor` or `substantial-drift` result has no meaningful
 * baseline to label, so it is `null` and the view renders the neutral state on the
 * diff `kind` alone.
 *
 * `migrations` is injectable for tests, forwarded to {@link diffSeriesIssue}.
 *
 * @throws {AppError} 404 when the issue or its predecessor is cross-author, unknown,
 * or malformed; 409 not-published when the issue itself is unpublished; 422 when a
 * stored snapshot fails to validate after migration.
 */
export async function getSeriesDiffView(
	id: string,
	scope: AuthorScope,
	migrations?: readonly DocumentMigration[]
): Promise<SeriesDiffView> {
	const diff = await diffSeriesIssue(id, scope, migrations);
	if (diff.kind !== 'diff') return { diff, baseline: null };

	// A computed diff means a published predecessor exists; resolve its display
	// labels from the owner-scoped ordered series. The issue's own row gives the
	// predecessor edge; the predecessor's `SeriesIssue` carries the baseline labels.
	const issue = await getReport(id, scope);
	const baseline = issue.seriesId === null ? null : await predecessorBaseline(issue, scope);
	return { diff, baseline };
}

/** The predecessor's display baseline within an owner-scoped series, or null when absent. */
async function predecessorBaseline(
	issue: Report,
	scope: AuthorScope
): Promise<SeriesDiffBaseline | null> {
	if (issue.predecessorId === null || issue.seriesId === null) return null;
	const issues = await listSeriesIssues(issue.seriesId, scope);
	const predecessor = issues.find((candidate) => candidate.id === issue.predecessorId);
	if (predecessor === undefined) return null;
	return {
		title: predecessor.title,
		issueLabel: predecessor.issueLabel,
		publishedAt: predecessor.publishedAt
	};
}
