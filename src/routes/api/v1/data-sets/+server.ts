import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveApiAuthorScope } from '$lib/server/authors';
import { ingestBytes, rebindReport } from '$lib/server/ingestion';
import { runApi } from '$lib/server/api';
import { formatFromContentType, readBodyBytes, readFilename, readTargetReportId } from './body';

/**
 * `POST /api/v1/data-sets` (FR13, FR14/15 parity) - the programmatic data push,
 * a THIN ADAPTER over the EXACT ingestion + binding services the upload form
 * uses. An API entry instead of a multipart form, but the SAME pipeline behind
 * it: parse -> store on the uploads volume -> inspect fields -> auto-rebind ->
 * diagnostics. Nothing is reimplemented; the only logic here is reading the
 * raw-body transport.
 *
 * Transport (backlog Epic 4 decision): the raw file bytes are the request body,
 * the format comes from `Content-Type` (`text/csv` / `application/json`; an
 * Excel content-type gets the honest 415 the upload flow gives), and the target
 * report is `?reportId=<uuid>`. An optional `X-Filename` header is recorded as
 * metadata only (the service stores bytes under a UUIDv7 name, never the client
 * value - the 2.4 path-traversal defence). The 50 MB cap is enforced by a
 * STREAMING read that aborts the moment cumulative bytes exceed the cap, so an
 * oversized body is never fully buffered (the DoS guard); a declared
 * `Content-Length` above the cap is a cheap pre-read 413 fast path; and the
 * assembled length is re-checked by `ingestBytes` (the 2.4 413).
 *
 * Binding (the upload-flow parity):
 *   - With `?reportId`, after the data set is stored the push runs the 2.5
 *     `rebindReport`: every bound block whose fields match the fresh data
 *     re-resolves (FR14), and the response carries the SAME per-block
 *     `BlockDiagnostic[]` + `BindingSummary` the workspace refill surfaces -
 *     green/drifted/unresolved, with the closest-match proposal for a drift
 *     (FR15) - serialized as JSON, not a UI payload. A drift/unresolved binding
 *     is reported in the body, never hidden.
 *   - `rebindReport` persists through `updateReportDocument`, which refuses a
 *     PUBLISHED report with a 409 (the same rule the workspace refill follows):
 *     a push onto a published report is a clean conflict, so the push targets a
 *     DRAFT.
 *   - Without `?reportId` the data set is stored unbound (the same state the
 *     upload form produces before a bind); the response carries the data set
 *     only, no diagnostics.
 *
 * Errors flow through `runApi` (the 4.2 correction: the `/api/*` handle boundary
 * does NOT catch endpoint throws): a parse failure is the 2.4 422/415
 * problem+json, an oversize body the 2.4 413, a published target the 2.5 409.
 */
export const POST: RequestHandler = ({ request, url, locals }) =>
	runApi(async () => {
		const format = formatFromContentType(request);
		const reportId = readTargetReportId(url);
		const filename = readFilename(request, format);
		const bytes = await readBodyBytes(request);
		const scope = await resolveApiAuthorScope(locals.apiIdentity!);

		const dataSet = await ingestBytes({ bytes, format, filename, scope, reportId });

		if (reportId === null) {
			return json({ dataSet }, { status: 201 });
		}

		const result = await rebindReport(reportId, dataSet.id, scope);
		return json(
			{
				dataSet,
				diagnostics: result.diagnostics,
				summary: result.summary,
				rebound: result.rebound
			},
			{ status: 201 }
		);
	});
