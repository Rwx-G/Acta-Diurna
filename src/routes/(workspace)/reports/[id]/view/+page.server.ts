import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { resolveAuthorScope } from '$lib/server/authors';
import { getReport } from '$lib/server/documents/reports';
import { validateStoredDocument, type DocumentV1, type ValidationErrorDetail } from '$lib/schema';
import { AppError, errorPageShape } from '$lib/server/problem';

/**
 * Author-only reader view of a report by id (under the workspace guard). This
 * is the SSR-first render surface for Epic 1: the same renderer a reader will
 * see, reachable from the editor.
 *
 * Author intent: this is the author's preview, so it renders the live DRAFT
 * (`report.document`) - the author wants to see their in-progress work, not a
 * stale published snapshot. The "what readers actually see" path is the frozen
 * published snapshot, served by `getPublishedDocument` and consumed by Epic 3's
 * public `/r/[token]` reader (not built here).
 *
 * FR7 (version-aware rendering): the stored document is run through
 * `validateStoredDocument`, which lifts an earlier supported schema version to
 * the current shape via the migration chain before validating. An unsupported
 * version is returned as a neutral error state for the page to render, never a
 * crash. The renderer only ever receives a current-version `DocumentV1`.
 */
export const load: PageServerLoad = async ({
	params,
	locals
}): Promise<
	| { reportId: string; document: DocumentV1; status: string; renderError: null }
	| { reportId: string; document: null; status: string; renderError: ValidationErrorDetail[] }
> => {
	try {
		const report = await getReport(
			params.id,
			await resolveAuthorScope(locals.authorSession?.authorId)
		);
		const result = validateStoredDocument(report.document);
		if (result.ok) {
			return {
				reportId: report.id,
				document: result.document,
				status: report.status,
				renderError: null
			};
		}
		return {
			reportId: report.id,
			document: null,
			status: report.status,
			renderError: result.errors
		};
	} catch (thrown) {
		if (thrown instanceof AppError) error(thrown.status, errorPageShape(thrown));
		throw thrown;
	}
};
