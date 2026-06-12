/**
 * Shared report-update composition (story 4.2 atomic-write fix, reused by 5.2).
 *
 * The REST `PATCH /api/v1/reports/:id` and the MCP `update_report` tool are two
 * surfaces over the SAME update behavior. Keeping the composition in one place
 * stops the surfaces from drifting - in particular the 4.2 QA-iteration-1
 * atomicity fix (a combined `{title, document}` update is a SINGLE guarded
 * `updateReportDocument` write, never a guarded-document-then-unguarded-title
 * pair that could silently lose a concurrent edit) must hold on every surface.
 *
 * The report title is canonically `document.title` (the documents service
 * derives the row title from it), so when both `title` and `document` are
 * present we set `document.title = title` and do one guarded document write.
 * Precedence: the explicit `title` wins over any `document.title` in the body.
 * At least one of `title`/`document` must be present (else a 400).
 *
 * This helper owns ONLY the composition (which service to call, how to merge),
 * not validation or persistence - `updateReportDocument`/`updateReportTitle`
 * still own validate-on-write, the published-read-only rule, and the 409 guard.
 */
import {
	updateReportDocument,
	updateReportTitle,
	type Report
} from '$lib/server/documents/reports';
import { AppError } from '$lib/server/problem';

export interface ReportUpdate {
	id: string;
	/** New title; when paired with `document` it overrides `document.title`. */
	title?: string;
	/** New document (validated inside the service); `unknown` because the service is the validator. */
	document?: unknown;
	/** Optimistic-concurrency token; a stale value yields the service 409. */
	expectedUpdatedAt?: Date;
}

function emptyUpdate(): AppError {
	return new AppError({
		status: 400,
		title: 'Empty update',
		type: '/problems/malformed-request',
		detail: 'Provide at least one of `title` or `document` to update.'
	});
}

/**
 * Routes a report update to the right documents service, composed exactly as
 * the 4.2 PATCH handler: combined `{title, document}` -> a single guarded
 * `updateReportDocument` with `document.title = title`; document-only ->
 * `updateReportDocument`; title-only -> `updateReportTitle` (its signature has
 * no concurrency token, reverting to draft is not a lost-update hazard).
 */
export function composeReportUpdate(update: ReportUpdate): Promise<Report> {
	const { id, title, document, expectedUpdatedAt } = update;
	const hasDocument = document !== undefined;
	const hasTitle = title !== undefined;

	if (!hasDocument && !hasTitle) throw emptyUpdate();

	if (hasDocument && hasTitle) {
		const merged = { ...(document as Record<string, unknown>), title };
		return updateReportDocument(id, merged, expectedUpdatedAt);
	}
	if (hasDocument) {
		return updateReportDocument(id, document, expectedUpdatedAt);
	}
	return updateReportTitle(id, title as string);
}
