import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { performLogout } from '$lib/server/auth/logout';
import {
	getReport,
	publishReport,
	unpublishToDraft,
	updateReportDocument
} from '$lib/server/documents/reports';
import { AppError, errorPageShape } from '$lib/server/problem';
import { applyNarrativeFields } from './editor-state';

export const load: PageServerLoad = async ({ params }) => {
	try {
		return { report: await getReport(params.id) };
	} catch (thrown) {
		// handleError cannot set a non-500 status for unexpected errors (1.4
		// note), so UI loads translate AppError to SvelteKit's error() here.
		if (thrown instanceof AppError) error(thrown.status, errorPageShape(thrown));
		throw thrown;
	}
};

export const actions: Actions = {
	save: async ({ params, request }) => {
		const data = await request.formData();
		const raw = data.get('document');
		try {
			let documentInput: unknown;
			if (typeof raw === 'string') {
				try {
					documentInput = JSON.parse(raw);
				} catch {
					// Same shape as the AppError failure below: a single ActionData
					// failure variant keeps `form.errors` well-typed for the page.
					return fail(400, { message: 'Malformed document payload.', errors: [] });
				}
			} else {
				// No-JS baseline: apply the posted narrative fields onto the
				// stored document, then validate like any other write.
				const current = await getReport(params.id);
				documentInput = applyNarrativeFields(current.document, data);
			}
			const report = await updateReportDocument(params.id, documentInput);
			return { savedAt: report.updatedAt.toISOString() };
		} catch (thrown) {
			if (thrown instanceof AppError) {
				return fail(thrown.status, {
					message: thrown.detail ?? thrown.title,
					errors: thrown.errors ?? []
				});
			}
			throw thrown;
		}
	},
	publish: async ({ params }) => {
		try {
			const report = await publishReport(params.id);
			return { published: true, status: report.status };
		} catch (thrown) {
			// A 422 (invalid draft) carries the actionable errors[]; the editor
			// renders them at the failing blocks, reusing the save-path rendering.
			if (thrown instanceof AppError) {
				return fail(thrown.status, {
					message: thrown.detail ?? thrown.title,
					errors: thrown.errors ?? []
				});
			}
			throw thrown;
		}
	},
	unpublish: async ({ params }) => {
		try {
			const report = await unpublishToDraft(params.id);
			return { published: false, status: report.status };
		} catch (thrown) {
			if (thrown instanceof AppError) {
				return fail(thrown.status, { message: thrown.detail ?? thrown.title, errors: [] });
			}
			throw thrown;
		}
	},
	logout: async ({ cookies }) => {
		await performLogout(cookies);
		redirect(303, '/login');
	}
};
