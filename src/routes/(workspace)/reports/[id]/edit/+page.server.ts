import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { performLogout } from '$lib/server/auth/logout';
import {
	getReport,
	publishReport,
	unpublishToDraft,
	updateReportDocument
} from '$lib/server/documents/reports';
import { bindBlock, listDataSets, type SlotMapping } from '$lib/server/ingestion';
import { MAX_DOCUMENT_BYTES } from '$lib/editor';
import { AppError, errorPageShape } from '$lib/server/problem';
import { parseSlotMapping } from './bind-form';
import { applyNarrativeFields } from './editor-state';

export const load: PageServerLoad = async ({ params }) => {
	try {
		return { report: await getReport(params.id), dataSets: await listDataSets() };
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
				if (raw.length > MAX_DOCUMENT_BYTES) {
					// Reject an oversized payload before JSON.parse spends memory on it.
					return fail(413, { message: 'Document payload is too large.', errors: [] });
				}
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
	bind: async ({ params, request }) => {
		const data = await request.formData();
		const blockId = String(data.get('blockId') ?? '');
		const dataSetId = String(data.get('dataSetId') ?? '');
		const rawMapping = String(data.get('slotMapping') ?? '');
		if (!blockId || !dataSetId) {
			return fail(400, { message: 'A block and a data set are required to bind.', errors: [] });
		}
		let slotMapping: SlotMapping;
		try {
			slotMapping = parseSlotMapping(rawMapping);
		} catch {
			return fail(400, { message: 'Malformed slot mapping.', errors: [] });
		}
		try {
			const report = await bindBlock(params.id, blockId, dataSetId, slotMapping);
			return { boundAt: report.updatedAt.toISOString() };
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
