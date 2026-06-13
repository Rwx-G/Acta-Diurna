import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { resolveAuthorScope } from '$lib/server/authors';
import { createReport } from '$lib/server/documents/reports';
import { DEFAULT_REPORT_TITLE } from './constants';

// GET has nothing to show: creation is a POST from the reports list.
export const load: PageServerLoad = async () => {
	redirect(303, '/reports');
};

export const actions: Actions = {
	// The draft gets a neutral title; the editor opens with the title field
	// ready for an inline rename (no intermediate naming form).
	default: async ({ locals }) => {
		const report = await createReport(
			DEFAULT_REPORT_TITLE,
			await resolveAuthorScope(locals.authorSession?.authorId)
		);
		redirect(303, `/reports/${report.id}/edit`);
	}
};
