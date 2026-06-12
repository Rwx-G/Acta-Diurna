import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getReport } from '$lib/server/documents/reports';
import { AppError, errorPageShape } from '$lib/server/problem';

/**
 * Author-only reader view of a report by id (under the workspace guard). This
 * is the SSR-first render surface for Epic 1: the same renderer a reader will
 * see, reachable from the editor. The public magic-link reader (`/r/[token]`)
 * is Epic 3 and is intentionally not built here.
 *
 * Returns only the validated document - the renderer needs nothing else
 * (purity boundary). The full section list is sent so the page is SSR-complete
 * (no loading state) and the reader-path JS only hydrates for SPA navigation.
 */
export const load: PageServerLoad = async ({ params }) => {
	try {
		const report = await getReport(params.id);
		return { document: report.document, status: report.status };
	} catch (thrown) {
		if (thrown instanceof AppError) error(thrown.status, errorPageShape(thrown));
		throw thrown;
	}
};
