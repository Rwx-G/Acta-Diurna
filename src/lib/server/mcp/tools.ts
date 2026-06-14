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
import {
	ingestBytes,
	MAX_UPLOAD_BYTES,
	rebindReport,
	tooLarge,
	type SourceFormat
} from '$lib/server/ingestion';
import {
	fillFromOutline,
	generateOutline,
	hashOutline,
	parseOutlineInput
} from '$lib/server/ai/generate';
import { AppError, rateLimited } from '$lib/server/problem';
import { aiGenerationLimiter, mcpGenerationRateKey } from '$lib/server/auth/rate-limit';
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

/** `list_skeletons` -> the OWNER-scoped skeleton library summaries (`listSkeletons`, id/name/updatedAt). */
export function listSkeletonsTool(scope: AuthorScope): Promise<McpToolResult> {
	return withProblemMapping(async () => jsonResult({ items: await listSkeletons(scope) }));
}

/**
 * `list_reports` -> a page of the OWNER-scoped report summaries (`listReports`,
 * id/title/status/updatedAt). Keyset-paginated like the REST list: an optional
 * `cursor` resumes after a prior page, and the result carries `{ items, nextCursor }`
 * so an agent pages the catalogue instead of hitting a silent cap (full-audit C2).
 */
export function listReportsTool(
	input: { cursor?: string },
	scope: AuthorScope
): Promise<McpToolResult> {
	return withProblemMapping(async () => {
		const page = await listReports(scope, { cursor: input.cursor });
		return jsonResult({ items: page.items, nextCursor: page.nextCursor });
	});
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

/*
 * Data-push tool (deferred Epic 5 follow-up, the FR13/14/15 parity of
 * `POST /api/v1/data-sets`). A THIN delegation to the EXACT ingestion + binding
 * services the REST push and the upload form call: store the data set under the
 * caller's scope, then with a `reportId` auto-rebind the target draft and return
 * the same per-block diagnostics + summary the REST push returns. No reparse, no
 * Drizzle, no binding logic here - the services own all of it. The only transport
 * difference from REST is the body: MCP is JSON-RPC, so the file arrives as a
 * `content` STRING (the agent's CSV/JSON text) instead of raw request bytes; it
 * is UTF-8 encoded into the bytes `ingestBytes` takes. The `format` is an explicit
 * argument (there is no Content-Type header on a tool call), restricted to the two
 * the REST push parses; an unparseable body is the service 422, a published target
 * the service 409, a foreign/unknown `reportId` the scoped 404.
 *
 * SIZE cap: an oversize `content` is rejected with the REST `tooLarge` 413 BEFORE
 * encoding, via a `Buffer.byteLength` measure that allocates nothing - so an
 * over-cap push never gets a full UTF-8 copy here on top of the one `ingestBytes`
 * would do. The transport `BODY_SIZE_LIMIT` already bounds the body upstream.
 */
export function pushDataSetTool(
	input: {
		content: string;
		format: SourceFormat;
		reportId?: string;
		filename?: string;
	},
	scope: AuthorScope
): Promise<McpToolResult> {
	return withProblemMapping(async () => {
		// Reject an oversize body BEFORE encoding: `Buffer.byteLength` measures the
		// UTF-8 size without allocating the bytes, so an over-cap push returns the
		// same 413 the REST path returns without the full encode + copy `ingestBytes`
		// would otherwise do a second time. The transport `BODY_SIZE_LIMIT` already
		// bounds the body, so this is a cheap guard, not the only one.
		if (Buffer.byteLength(input.content, 'utf8') > MAX_UPLOAD_BYTES) {
			throw tooLarge(MAX_UPLOAD_BYTES);
		}
		const bytes = new TextEncoder().encode(input.content);
		const reportId = input.reportId ?? null;
		const dataSet = await ingestBytes({
			bytes,
			format: input.format,
			filename: input.filename ?? `mcp-push.${input.format}`,
			scope,
			reportId
		});
		if (reportId === null) {
			return jsonResult({ dataSet });
		}
		const result = await rebindReport(reportId, dataSet.id, scope);
		return jsonResult({
			dataSet,
			diagnostics: result.diagnostics,
			summary: result.summary,
			rebound: result.rebound
		});
	});
}

/*
 * Outline-first generation tools (item 18, the FR32 parity of the workspace
 * generate actions). Epic 5 shipped outline-first generation as a workspace-only
 * flow; these expose the SAME two-stage service (`generateOutline` then
 * `fillFromOutline`) over MCP, owner-scoped through the same `AuthorScope`. Both
 * AI gates are enforced INSIDE the service: every call goes through `chatComplete`,
 * which asserts configured AND opted-in before any outbound request, so a disabled
 * instance is the `/problems/ai-generation-disabled` 503 carried into the tool
 * error channel - no call, no tool result leak. The approval-hash binding is the
 * service's: `fillFromOutline` re-hashes the posted outline and rejects a mismatch
 * (409) before any LLM call. The same PAT identity drives both stages and the hash
 * is a value the agent holds (not server-redeemable state), so the content-hash
 * binding is sufficient on a single principal - no cross-principal substitution
 * surface, no server-minted nonce needed.
 *
 * COST/DoS brake: each stage issues a metered LLM call, so both tools consume the
 * SAME `aiGenerationLimiter` the REST generate routes use BEFORE any `chatComplete`,
 * keyed per AUTHOR (`mcpGenerationRateKey(scope.authorId)`; MCP carries no token id).
 * On deny they return the standard 429 problem via the tool error channel and make
 * no LLM call.
 */

/**
 * `generate_outline` -> stage 1: a bounded, reviewable outline plus its content
 * hash (`{ outline, outlineHash }`). The agent approves the outline and posts it
 * back with the hash to `generate_report`. A disabled instance is the 503, an
 * unparseable model outline the staged 502 - both as problem-details tool errors.
 */
export function generateOutlineTool(
	input: { intent: string; skeletonId?: string; dataSetId?: string },
	scope: AuthorScope
): Promise<McpToolResult> {
	return withProblemMapping(async () => {
		const decision = aiGenerationLimiter.consume(mcpGenerationRateKey(scope.authorId));
		if (!decision.allowed) {
			throw rateLimited(decision.retryAfterSeconds);
		}
		const outline = await generateOutline(
			{
				intent: input.intent,
				skeletonId: input.skeletonId ?? null,
				dataSetId: input.dataSetId ?? null
			},
			scope
		);
		return jsonResult({ outline, outlineHash: hashOutline(outline) });
	});
}

/**
 * `generate_report` -> stage 2: fills the APPROVED outline into a draft and writes
 * it through the EXACT owner-scoped validate-on-write the REST surface uses. With a
 * `reportId` it replaces that draft's document (a published report / stale
 * `expectedUpdatedAt` is a 409); without one it seeds a fresh draft. A mismatched
 * `outlineHash` is the 409 stale-approval error BEFORE any LLM call; an invalid
 * model document is the validator's 422 with `errors[]` and the draft is untouched.
 * The `outline` arg is Zod-parsed against the canonical outline schema at the tool
 * ENTRY (`parseOutlineInput`): a misshapen outline is a 400 BEFORE any LLM call,
 * moving the trust boundary off the final `validateDocument` onto a clear message.
 */
export function fillOutlineTool(
	input: {
		outline: Record<string, unknown>;
		outlineHash: string;
		reportId?: string;
		skeletonId?: string;
		dataSetId?: string;
		expectedUpdatedAt?: string;
	},
	scope: AuthorScope
): Promise<McpToolResult> {
	return withProblemMapping(async () => {
		const outline = parseOutlineInput(input.outline);
		if (!outline) {
			throw new AppError({
				status: 400,
				title: 'Invalid Outline',
				type: '/problems/invalid-outline',
				detail:
					'The outline does not match the expected shape (a title and at least one section, ' +
					'each with at least one block of a known type). Generate the outline with ' +
					'generate_outline and post it back unchanged.'
			});
		}
		const decision = aiGenerationLimiter.consume(mcpGenerationRateKey(scope.authorId));
		if (!decision.allowed) {
			throw rateLimited(decision.retryAfterSeconds);
		}
		return jsonResult(
			await fillFromOutline(
				{
					intent: '',
					outline,
					approvedHash: input.outlineHash,
					skeletonId: input.skeletonId ?? null,
					dataSetId: input.dataSetId ?? null
				},
				scope,
				input.reportId,
				toExpectedDate(input.expectedUpdatedAt)
			)
		);
	});
}
