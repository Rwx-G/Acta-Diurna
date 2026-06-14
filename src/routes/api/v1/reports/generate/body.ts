/**
 * Request-body parsing for the `/api/v1/reports/generate/*` endpoints (the
 * outline-first generation surface). The endpoints stay thin adapters: the ONLY
 * logic here is reading the JSON envelope and shaping the fill inputs, so a
 * malformed body becomes the standard problem+json (the `/api/*` boundary formats
 * the thrown AppError) instead of an opaque crash.
 *
 * No generation logic and no outline validation live here: the generation service
 * (`generateOutline` / `fillFromOutline`) owns the prompt bounds, the approval-hash
 * binding, the defensive model parsing, and the validate-on-write - the same path
 * the workspace generation actions drive. These helpers only parse transport.
 */
import { AppError } from '$lib/server/problem';
import type { Outline } from '$lib/server/ai/generate';
import { readExpectedUpdatedAt, readJsonObject } from '../body';

function malformedBody(detail: string): AppError {
	return new AppError({
		status: 400,
		title: 'Malformed request body',
		type: '/problems/malformed-request',
		detail
	});
}

/** Reads the optional free-text intent that grounds the outline prompt; a non-string is a 400. */
function readIntent(body: Record<string, unknown>): string {
	const raw = body['intent'];
	if (raw === undefined || raw === null) return '';
	if (typeof raw !== 'string') throw malformedBody('`intent` must be a string.');
	return raw;
}

/** Reads an optional id field (skeleton / data set / report); a non-string is a 400, absent is null. */
function readOptionalId(body: Record<string, unknown>, key: string): string | null {
	const raw = body[key];
	if (raw === undefined || raw === null) return null;
	if (typeof raw !== 'string') throw malformedBody(`\`${key}\` must be a string.`);
	return raw;
}

/** The parsed `POST /generate/outline` request: an intent plus optional grounding ids. */
export interface OutlineRequest {
	intent: string;
	skeletonId: string | null;
	dataSetId: string | null;
}

/**
 * Reads the outline-request envelope `{ intent, skeletonId?, dataSetId? }`. The
 * intent is required (an outline with no narrative to follow is meaningless), so
 * an empty intent is a 400 - the workspace action enforces the same rule.
 */
export async function readOutlineRequest(request: Request): Promise<OutlineRequest> {
	const body = await readJsonObject(request);
	const intent = readIntent(body).trim();
	if (!intent) {
		throw malformedBody('`intent` is required: describe what the report should cover.');
	}
	return {
		intent,
		skeletonId: readOptionalId(body, 'skeletonId'),
		dataSetId: readOptionalId(body, 'dataSetId')
	};
}

/** The parsed `POST /generate/fill` request: the approved outline + its hash, the target, and the grounding ids. */
export interface FillRequest {
	outline: Outline;
	outlineHash: string;
	reportId: string | null;
	skeletonId: string | null;
	dataSetId: string | null;
	expectedUpdatedAt: Date | undefined;
}

/**
 * Reads the fill-request envelope `{ outline, outlineHash, reportId?, skeletonId?,
 * dataSetId?, expectedUpdatedAt? }`. The `outline` must be a JSON object and
 * `outlineHash` a non-empty string; both are required because the fill is bound to
 * the approved outline by its hash (the service re-hashes the posted outline and
 * rejects a mismatch BEFORE any LLM call - the re-approval discipline). The outline
 * is passed through as-is: the service re-bounds it when it assembles the document
 * and `validateDocument` is the final gate, so no shape validation belongs here.
 */
export async function readFillRequest(request: Request): Promise<FillRequest> {
	const body = await readJsonObject(request);

	const rawOutline = body['outline'];
	if (typeof rawOutline !== 'object' || rawOutline === null || Array.isArray(rawOutline)) {
		throw malformedBody('`outline` must be the approved outline object.');
	}

	const outlineHash = body['outlineHash'];
	if (typeof outlineHash !== 'string' || outlineHash.length === 0) {
		throw malformedBody(
			'`outlineHash` is required: approve the outline (the hash returned by /generate/outline) before generating content.'
		);
	}

	return {
		outline: rawOutline as Outline,
		outlineHash,
		reportId: readOptionalId(body, 'reportId'),
		skeletonId: readOptionalId(body, 'skeletonId'),
		dataSetId: readOptionalId(body, 'dataSetId'),
		expectedUpdatedAt: readExpectedUpdatedAt(body)
	};
}
