import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { resolveAuthorScope } from '$lib/server/authors';
import { AppError } from '$lib/server/problem';
import { deleteSkeleton, instantiateReport, listSkeletons } from '$lib/server/skeletons/skeletons';

export const load: PageServerLoad = async () => {
	return { skeletons: await listSkeletons() };
};

export const actions: Actions = {
	// Create a report from a skeleton (FR11): instantiate a draft mirroring the
	// skeleton structure, then open it in the editor.
	instantiate: async ({ request }) => {
		const data = await request.formData();
		const id = data.get('id');
		if (typeof id !== 'string') return fail(400, { message: 'Missing skeleton id.' });
		let reportId: string;
		try {
			const report = await instantiateReport(id, await resolveAuthorScope());
			reportId = report.id;
		} catch (thrown) {
			if (thrown instanceof AppError) {
				return fail(thrown.status, { message: thrown.detail ?? thrown.title });
			}
			throw thrown;
		}
		redirect(303, `/reports/${reportId}/edit`);
	},
	delete: async ({ request }) => {
		const data = await request.formData();
		const id = data.get('id');
		if (typeof id !== 'string') return fail(400, { message: 'Missing skeleton id.' });
		try {
			await deleteSkeleton(id);
		} catch (thrown) {
			if (thrown instanceof AppError) {
				return fail(thrown.status, { message: thrown.detail ?? thrown.title });
			}
			throw thrown;
		}
		return { deleted: true };
	}
};
