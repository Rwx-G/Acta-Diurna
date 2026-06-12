import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { performLogout } from '$lib/server/auth/logout';
import {
	getReport,
	publishReport,
	unpublishToDraft,
	updateReportDocument
} from '$lib/server/documents/reports';
import {
	bindBlock,
	listDataSets,
	rebindReport,
	remapField,
	type SlotMapping
} from '$lib/server/ingestion';
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
	rebind: async ({ params, request }) => {
		// Auto-rebinding (FR14): inject a fresh data set and re-resolve every bound
		// block whose fields match it. Returns the per-block diagnostics + the
		// summary so the chips turn green/amber/red in one action.
		const data = await request.formData();
		const dataSetId = String(data.get('dataSetId') ?? '');
		if (!dataSetId) {
			return fail(400, { message: 'A data set is required to rebind.', errors: [] });
		}
		try {
			const result = await rebindReport(params.id, dataSetId);
			return {
				reboundAt: result.report.updatedAt.toISOString(),
				diagnostics: result.diagnostics,
				summary: result.summary,
				rebound: result.rebound
			};
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
	remap: async ({ params, request }) => {
		// Remap-in-place (FR15): point a drifted expected field at an available
		// field; the remap persists in the binding and the block re-resolves.
		const data = await request.formData();
		const blockId = String(data.get('blockId') ?? '');
		const dataSetId = String(data.get('dataSetId') ?? '');
		const expectedField = String(data.get('expectedField') ?? '');
		const availableField = String(data.get('availableField') ?? '');
		if (!blockId || !dataSetId || !expectedField || !availableField) {
			return fail(400, { message: 'A block, data set, and field pair are required.', errors: [] });
		}
		try {
			const report = await remapField(params.id, blockId, dataSetId, expectedField, availableField);
			return { remappedAt: report.updatedAt.toISOString() };
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
