/**
 * Transport parsing for `POST /api/v1/data-sets` (story 4.3). The endpoint is a
 * thin adapter over the SAME ingestion + binding services the upload form uses;
 * the only logic here is reading the raw-body transport (format from
 * `Content-Type`, target from the query, the streaming byte-cap) into the shape
 * `ingestBytes` takes. Every business rule (parse, inspect, store, bind,
 * rebind, diagnostics) stays in the reused services.
 */
import { MAX_UPLOAD_BYTES, readStreamToCap, type SourceFormat } from '$lib/server/ingestion';
import { excelNotEnabled, tooLarge, unsupportedFormat } from '$lib/server/ingestion/errors';
import { AppError } from '$lib/server/problem';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function malformedRequest(detail: string): AppError {
	return new AppError({
		status: 400,
		title: 'Malformed request',
		type: '/problems/malformed-request',
		detail
	});
}

/**
 * Resolves the source format from the request `Content-Type` (the 4.3 transport
 * decision: format from the header, not a multipart filename). `text/csv` and
 * `application/json` parse; an Excel content-type is recognized and routed to
 * the honest `excelNotEnabled` 415 (parity with the upload flow's parked Excel
 * branch); anything else is the 415 unsupported-format the upload flow gives.
 * The charset/parameter suffix (`; charset=utf-8`) is ignored.
 */
export function formatFromContentType(request: Request): SourceFormat {
	const header = request.headers.get('content-type') ?? '';
	const mime = header.split(';')[0].trim().toLowerCase();
	if (mime === 'text/csv') return 'csv';
	if (mime === 'application/json') return 'json';
	if (
		mime === 'application/vnd.ms-excel' ||
		mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	) {
		// Recognized but parked (backlog "Excel parser dependency choice"): the
		// honest 415, identical to the upload flow.
		throw excelNotEnabled();
	}
	throw unsupportedFormat(
		`Unsupported Content-Type "${mime || '(none)'}". Send text/csv or application/json.`
	);
}

/**
 * Reads the optional target report id from the query string. Absent -> null (an
 * unbound data set, the same state the upload flow produces before a bind);
 * present-but-malformed -> a 400, so a typo fails loudly rather than silently
 * creating an unbound set when the caller meant to target a report.
 */
export function readTargetReportId(url: URL): string | null {
	const raw = url.searchParams.get('reportId');
	if (raw === null) return null;
	if (!UUID_PATTERN.test(raw)) {
		throw malformedRequest('`reportId` must be a UUID.');
	}
	return raw;
}

/**
 * The filename to record on the `data_sets` row. It is metadata only - the
 * service stores bytes under a UUIDv7 name, never the client value (the 2.4
 * path-traversal defence) - so an arbitrary header value is safe. Optional
 * `X-Filename` header, else a format-appropriate default.
 */
export function readFilename(request: Request, format: SourceFormat): string {
	const raw = request.headers.get('x-filename');
	if (raw && raw.trim() !== '') return raw.trim();
	return `api-push.${format}`;
}

/**
 * Reads the request body into bytes, bounding memory at `MAX_UPLOAD_BYTES`.
 *
 * The declared `Content-Length` is a cheap fast-path early rejection: above the
 * cap, a 413 with no read at all. But Content-Length is client-supplied and
 * omittable (a chunked request can lie or omit it), so it is NOT the real bound.
 * The real bound is the shared streaming read (`readStreamToCap`): chunks are
 * pulled one at a time and the cumulative byte count is checked after each; the
 * instant it exceeds the cap the reader is cancelled and a 413 is thrown, so an
 * oversized body is never fully buffered (the DoS guard). `ingestBytes` re-checks
 * the assembled length as the second line. An empty body is a 400.
 */
export async function readBodyBytes(request: Request): Promise<Uint8Array> {
	const declared = request.headers.get('content-length');
	if (declared !== null) {
		const length = Number(declared);
		if (Number.isFinite(length) && length > MAX_UPLOAD_BYTES) {
			throw tooLarge(MAX_UPLOAD_BYTES);
		}
	}

	if (request.body === null) {
		throw malformedRequest('The request body is empty; send the file bytes.');
	}

	const bytes = await readStreamToCap(request.body);

	if (bytes.byteLength === 0) {
		throw malformedRequest('The request body is empty; send the file bytes.');
	}
	return bytes;
}
