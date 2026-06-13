import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { resolveAuthorScope } from '$lib/server/authors';
import { performLogout } from '$lib/server/auth/logout';
import { deleteDraft, duplicateReport, listReports } from '$lib/server/documents/reports';
import { AppError } from '$lib/server/problem';

export const load: PageServerLoad = async ({ locals }) => {
	return { reports: await listReports(await resolveAuthorScope(locals.authorSession?.authorId)) };
};

export const actions: Actions = {
	delete: async ({ request, locals }) => {
		const data = await request.formData();
		const id = data.get('id');
		if (typeof id !== 'string') return fail(400, { message: 'Missing report id.' });
		try {
			await deleteDraft(id, await resolveAuthorScope(locals.authorSession?.authorId));
		} catch (thrown) {
			if (thrown instanceof AppError) {
				return fail(thrown.status, { message: thrown.detail ?? thrown.title });
			}
			throw thrown;
		}
		return { deleted: true };
	},
	// Duplicate any report into a fresh draft (FR10) and open it in the editor.
	duplicate: async ({ request, locals }) => {
		const data = await request.formData();
		const id = data.get('id');
		if (typeof id !== 'string') return fail(400, { message: 'Missing report id.' });
		let newId: string;
		try {
			const report = await duplicateReport(
				id,
				await resolveAuthorScope(locals.authorSession?.authorId)
			);
			newId = report.id;
		} catch (thrown) {
			if (thrown instanceof AppError) {
				return fail(thrown.status, { message: thrown.detail ?? thrown.title });
			}
			throw thrown;
		}
		redirect(303, `/reports/${newId}/edit`);
	},
	logout: async ({ cookies }) => {
		await performLogout(cookies);
		redirect(303, '/login');
	}
};
