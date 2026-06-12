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
import { getReport, listReports } from '$lib/server/documents/reports';
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

/** `list_reports` -> the report summaries (`listReports`, id/title/status/updatedAt). */
export function listReportsTool(): Promise<McpToolResult> {
	return withProblemMapping(async () => jsonResult({ items: await listReports() }));
}

/** `get_report` -> one full report (`getReport`); an unknown id is the service 404 as a tool error. */
export function getReportTool(id: string): Promise<McpToolResult> {
	return withProblemMapping(async () => jsonResult(await getReport(id)));
}
