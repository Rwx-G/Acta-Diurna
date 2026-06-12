import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createReport } from '$lib/server/documents/reports';

// GET has nothing to show: creation is a POST from the reports list.
export const load: PageServerLoad = async () => {
	redirect(303, '/reports');
};

export const actions: Actions = {
	// The draft gets a neutral title; the editor opens with the title field
	// ready for an inline rename (no intermediate naming form).
	default: async () => {
		const report = await createReport('Untitled report');
		redirect(303, `/reports/${report.id}/edit`);
	}
};
