/**
 * MCP read-only tool handlers (story 5.1, FR31 read surface). Each handler is a
 * THIN function over the EXACT service the REST API and workspace call - the AR5
 * "one service layer, four surfaces" contract (reader cookie / author cookie /
 * REST PAT / MCP PAT). No validation, no ownership check, no Drizzle here: a
 * handler that grows any of those breaks four-surface parity, so they stay pure
 * delegation. The `+server.ts` route registers these on the `McpServer`; keeping
 * the logic here (not inline in the registration) makes the surface
 * unit-testable without driving a full MCP client.
 *
 * Error mapping (AR5/D9): a service `AppError` is carried into the MCP tool error
 * channel as an `isError: true` result whose text content is the SAME RFC 9457
 * problem-details JSON the REST API returns (`{ type, title, status, detail,
 * errors? }`, via `toProblemDetails`), so an agent reuses the machine-actionable
 * `errors[]` parser it already runs against REST. An unexpected (non-AppError)
 * throw is re-thrown so the SDK turns it into a JSON-RPC internal error - it is
 * never leaked as a tool result. Auth failure is NOT a tool result: it is the
 * transport-level 401 the `apiAuth` hook returns before the route runs.
 */
import type { AuthorScope } from '$lib/server/authors';
import {
	createReport,
	createReportWithDocument,
	deleteDraft,
	getReport,
	listReports,
	publishReport,
	unpublishToDraft
} from '$lib/server/documents/reports';
import { composeReportUpdate, type ReportUpdate } from '$lib/server/documents/update-composition';
import { DEFAULT_REPORT_TITLE } from '$lib/server/documents/defaults';
import { AppError } from '$lib/server/problem';
import { getPublishedSchema } from '$lib/server/schema/published';
import { listSkeletons } from '$lib/server/skeletons/skeletons';

export interface McpToolResult {
	content: { type: 'text'; text: string }[];
	isError?: boolean;
	// The SDK's CallToolResult carries an open index signature; mirror it so a
	// handler result is directly assignable to the registerTool callback return.
	[key: string]: unknown;
}

/** Serializes a value as the single JSON text-content block of a tool result. */
function jsonResult(value: unknown): McpToolResult {
	return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

/**
 * Maps an `AppError` to the RFC 9457 problem-details object the REST surface
 * returns, carried as an `isError` tool result. Mirrors `problemResponse`'s body
 * shape (no second error model) but in the MCP tool error channel.
 */
function problemResult(error: AppError): McpToolResult {
	const problem: Record<string, unknown> = {
		type: error.type,
		title: error.title,
		status: error.status
	};
	if (error.detail !== undefined) problem.detail = error.detail;
	if (error.errors !== undefined) problem.errors = error.errors;
	return { content: [{ type: 'text', text: JSON.stringify(problem) }], isError: true };
}

/**
 * Runs a handler, mapping a thrown `AppError` to the problem-details tool error
 * result and re-throwing anything else (the SDK renders it as a JSON-RPC internal
 * error - no internal detail in a tool result).
 */
async function withProblemMapping(run: () => Promise<McpToolResult>): Promise<McpToolResult> {
	try {
		return await run();
	} catch (thrown) {
		if (thrown instanceof AppError) return problemResult(thrown);
		throw thrown;
	}
}

/** `get_schema` -> the published `{ version, schema, examples }` (same as REST `/api/v1/schema`). */
export function getSchemaTool(): Promise<McpToolResult> {
	return withProblemMapping(async () => jsonResult(getPublishedSchema()));
}

/** `list_skeletons` -> the skeleton library summaries (`listSkeletons`, id/name/updatedAt). */
export function listSkeletonsTool(): Promise<McpToolResult> {
	return withProblemMapping(async () => jsonResult({ items: await listSkeletons() }));
}

/** `list_reports` -> the OWNER-scoped report summaries (`listReports`, id/title/status/updatedAt). */
export function listReportsTool(scope: AuthorScope): Promise<McpToolResult> {
	return withProblemMapping(async () => jsonResult({ items: await listReports(scope) }));
}

/** `get_report` -> one full report (`getReport`); an unknown or cross-author id is the service 404 as a tool error. */
export function getReportTool(id: string, scope: AuthorScope): Promise<McpToolResult> {
	return withProblemMapping(async () => jsonResult(await getReport(id, scope)));
}

/*
 * Write tools (story 5.2, FR31 authoring). Each is a THIN delegation to the EXACT
 * documents/publish service the REST `/api/v1/reports` endpoints call - no
 * validation, no Drizzle, no composition logic that the route does not also use
 * (the combined update goes through the shared `composeReportUpdate`). A service
 * `AppError` (422 invalid document with `errors[]`, 409 stale/published, 404
 * unknown id) is carried into the tool error channel as the SAME problem-details
 * body REST returns, via `withProblemMapping`/`problemResult` - byte-parity with
 * the REST error bodies. The `document` arg is `unknown`: the SERVICE's
 * `validateDocument` is the validator (the handler does not re-validate), so an
 * invalid document surfaces as the FR2 422 with the actionable `errors[]`.
 */

/** Tool-arg `expectedUpdatedAt` is a zod-validated ISO string; the services take a `Date`. */
function toExpectedDate(expectedUpdatedAt: string | undefined): Date | undefined {
	return expectedUpdatedAt === undefined ? undefined : new Date(expectedUpdatedAt);
}

/**
 * `create_report` -> `createReportWithDocument(document)` when a document is
 * given (the skeleton/instantiation path), else `createReport(title)` with the
 * blank starter (mirroring `POST /api/v1/reports`). Returns the created report.
 */
export function createReportTool(
	input: {
		title?: string;
		document?: unknown;
	},
	scope: AuthorScope
): Promise<McpToolResult> {
	return withProblemMapping(async () => {
		if (input.document !== undefined) {
			return jsonResult(await createReportWithDocument(input.document, scope));
		}
		return jsonResult(await createReport(input.title ?? DEFAULT_REPORT_TITLE, scope));
	});
}

/**
 * `update_report` -> the shared `composeReportUpdate` (same composition the REST
 * PATCH uses): combined `{title, document}` is ONE guarded `updateReportDocument`
 * write with `document.title = title`; document-only / title-only route to the
 * matching service. A stale `expectedUpdatedAt` is the service 409.
 */
export function updateReportTool(
	input: {
		id: string;
		title?: string;
		document?: unknown;
		expectedUpdatedAt?: string;
	},
	scope: AuthorScope
): Promise<McpToolResult> {
	return withProblemMapping(async () => {
		const update: ReportUpdate = {
			id: input.id,
			title: input.title,
			document: input.document,
			expectedUpdatedAt: toExpectedDate(input.expectedUpdatedAt)
		};
		return jsonResult(await composeReportUpdate(update, scope));
	});
}

/** `publish_report` -> `publishReport(id, scope, expectedUpdatedAt?)`; idempotent on a published report. */
export function publishReportTool(
	input: {
		id: string;
		expectedUpdatedAt?: string;
	},
	scope: AuthorScope
): Promise<McpToolResult> {
	return withProblemMapping(async () =>
		jsonResult(await publishReport(input.id, scope, toExpectedDate(input.expectedUpdatedAt)))
	);
}

/** `unpublish_report` -> `unpublishToDraft(id, scope)`; idempotent on a draft, no concurrency token. */
export function unpublishReportTool(id: string, scope: AuthorScope): Promise<McpToolResult> {
	return withProblemMapping(async () => jsonResult(await unpublishToDraft(id, scope)));
}

/** `delete_report` -> `deleteDraft(id, scope)`; a published report is the service 409 (not deletable). */
export function deleteReportTool(id: string, scope: AuthorScope): Promise<McpToolResult> {
	return withProblemMapping(async () => {
		await deleteDraft(id, scope);
		return jsonResult({ id, deleted: true });
	});
}
