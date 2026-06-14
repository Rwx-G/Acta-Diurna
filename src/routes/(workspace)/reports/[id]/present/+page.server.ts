import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { resolveAuthorScope } from '$lib/server/authors';
import { getReport } from '$lib/server/documents/reports';
import { validateStoredDocument, type DocumentV1, type ValidationErrorDetail } from '$lib/schema';
import { AppError, errorPageShape } from '$lib/server/problem';

/**
 * Presenter view loader (Story 6.2), a WORKSPACE route behind the auth guard and
 * scoped to the OWNER via the Epic 8 author scope: `getReport` ANDs the owner
 * predicate, so a non-owner or unknown id raises the SAME 404 - no existence
 * oracle (story 8.2 tenancy).
 *
 * The presenter runs the PUBLISHED snapshot (the AC: "a published report"), not
 * the live draft, so the presenter walks exactly what readers received. A report
 * that is not yet published returns a `not-published` state the page renders as a
 * clear "publish first" prompt rather than presenting an empty deck.
 *
 * Speaker notes are author-only and reach the presenter HERE because the route is
 * owner-scoped: this loads the report's own `publishedDocument` (which keeps its
 * notes) rather than the reader chokepoint `getPublishedDocument` (which strips
 * them). The notes never leave this owner-scoped surface.
 *
 * FR7 (version tolerance): the snapshot is run through `validateStoredDocument`,
 * lifting an earlier supported version forward before validating; an unsupported
 * version returns a neutral render-error state, never a crash.
 */
export const load: PageServerLoad = async ({
	params,
	locals
}): Promise<
	| { state: 'ready'; title: string; document: DocumentV1; renderError: null }
	| { state: 'ready'; title: string; document: null; renderError: ValidationErrorDetail[] }
	| { state: 'not-published'; title: string }
> => {
	try {
		const report = await getReport(
			params.id,
			await resolveAuthorScope(locals.authorSession?.authorId)
		);
		if (report.status !== 'published' || report.publishedDocument === null) {
			return { state: 'not-published', title: report.title };
		}
		const result = validateStoredDocument(report.publishedDocument);
		if (result.ok) {
			return { state: 'ready', title: report.title, document: result.document, renderError: null };
		}
		return { state: 'ready', title: report.title, document: null, renderError: result.errors };
	} catch (thrown) {
		if (thrown instanceof AppError) error(thrown.status, errorPageShape(thrown));
		throw thrown;
	}
};
