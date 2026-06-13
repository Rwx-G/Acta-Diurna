import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { resolveAuthorScope } from '$lib/server/authors';
import { getReport } from '$lib/server/documents/reports';
import { AppError, errorPageShape } from '$lib/server/problem';

/**
 * Workspace LivePreview: the SAME renderer the reader gets, fed the stored
 * document. The page renders it through the preview path (`toPreviewView`),
 * which tolerates a transiently-invalid snapshot - so when this preview is
 * embedded in the editor and fed `$state.snapshot(document)` mid-edit, valid
 * blocks still render and invalid ones surface a gentle notice (AR: "what you
 * preview is what they read").
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	try {
		const report = await getReport(
			params.id,
			await resolveAuthorScope(locals.authorSession?.authorId)
		);
		return { reportId: report.id, document: report.document };
	} catch (thrown) {
		if (thrown instanceof AppError) error(thrown.status, errorPageShape(thrown));
		throw thrown;
	}
};
