import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { resolveAuthorScope } from '$lib/server/authors';
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
import { listSkeletons } from '$lib/server/skeletons/skeletons';
import { isAiEnabled } from '$lib/server/ai/connector';
import {
	fillFromOutline,
	generateOutline,
	hashOutline,
	type Outline
} from '$lib/server/ai/generate';
import { MAX_DOCUMENT_BYTES } from '$lib/editor';
import { aiGenerationLimiter } from '$lib/server/auth/rate-limit';
import { AppError, errorPageShape, rateLimited } from '$lib/server/problem';
import { runAction } from '$lib/server/action';
import { parseSlotMapping } from './bind-form';
import { applyNarrativeFields } from './editor-state';
import type { BindActionResult, RebindActionResult, RemapActionResult } from './editor-types';

/**
 * Parses the editor-posted `expectedUpdatedAt` (an ISO timestamp) into a Date for
 * the optimistic-concurrency check, or undefined when absent or unparseable. A
 * caller without JS (the no-JS narrative save) posts no such field, so it stays on
 * the single-writer path; a malformed value never throws here - it degrades to the
 * single-writer path rather than failing a save the author cannot diagnose.
 */
function parseExpectedUpdatedAt(value: FormDataEntryValue | null): Date | undefined {
	if (typeof value !== 'string' || value.length === 0) return undefined;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	try {
		const scope = await resolveAuthorScope(locals.authorSession?.authorId);
		return {
			report: await getReport(params.id, scope),
			dataSets: (await listDataSets(scope)).items,
			// FR33/FR32: the Generate-with-AI entry point is offered only when the
			// connector is configured AND opted-in. When disabled the workspace hides
			// the trigger (no offer of a capability that 503s); the panel renders the
			// enable hint instead. Skeletons feed the generation request panel.
			aiEnabled: isAiEnabled(),
			skeletons: await listSkeletons(scope)
		};
	} catch (thrown) {
		// handleError cannot set a non-500 status for unexpected errors (1.4
		// note), so UI loads translate AppError to SvelteKit's error() here.
		if (thrown instanceof AppError) error(thrown.status, errorPageShape(thrown));
		throw thrown;
	}
};

export const actions: Actions = {
	save: async ({ params, request, locals }) => {
		const data = await request.formData();
		const raw = data.get('document');
		// Optimistic concurrency (Epic 10.1): the editor posts the `updatedAt` it
		// loaded so a write that lands after a concurrent edit (a second tab, an API
		// push, an MCP write) is rejected by the service as a 409 conflict instead of
		// a silent last-writer-wins overwrite. A malformed or absent value parses to
		// undefined, which the service treats as the single-writer path (no concurrency
		// check) - the no-JS baseline, which posts no `expectedUpdatedAt`, keeps its
		// last-writer-wins semantics unchanged.
		const expectedUpdatedAt = parseExpectedUpdatedAt(data.get('expectedUpdatedAt'));
		return runAction(
			async () => {
				const scope = await resolveAuthorScope(locals.authorSession?.authorId);
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
					const current = await getReport(params.id, scope);
					documentInput = applyNarrativeFields(current.document, data);
				}
				const report = await updateReportDocument(
					params.id,
					documentInput,
					scope,
					expectedUpdatedAt
				);
				return { savedAt: report.updatedAt.toISOString() };
			},
			(problem) => ({ message: problem.message, errors: problem.errors })
		);
	},
	bind: async ({ params, request, locals }) => {
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
		return runAction(
			async () => {
				const report = await bindBlock(
					params.id,
					blockId,
					dataSetId,
					slotMapping,
					await resolveAuthorScope(locals.authorSession?.authorId)
				);
				// Return the bound document AND its new `updatedAt` (Epic 10.5): a bind
				// mutates the report, so the editor reseeds its working copy from THIS
				// result and advances the concurrency token, the same self-contained
				// reconciliation publish/unpublish use - so the next document save asserts
				// the post-bind state instead of spuriously 409-ing on the stale value.
				return {
					boundAt: report.updatedAt.toISOString(),
					document: report.document
				} satisfies BindActionResult;
			},
			(problem) => ({ message: problem.message, errors: problem.errors })
		);
	},
	rebind: async ({ params, request, locals }) => {
		// Auto-rebinding (FR14): inject a fresh data set and re-resolve every bound
		// block whose fields match it. Returns the per-block diagnostics + the
		// summary so the chips turn green/amber/red in one action.
		const data = await request.formData();
		const dataSetId = String(data.get('dataSetId') ?? '');
		if (!dataSetId) {
			return fail(400, { message: 'A data set is required to rebind.', errors: [] });
		}
		return runAction(
			async () => {
				const result = await rebindReport(
					params.id,
					dataSetId,
					await resolveAuthorScope(locals.authorSession?.authorId)
				);
				// The re-resolved document (Epic 10.5): the editor reseeds its working copy
				// from this and advances the concurrency token off `reboundAt`, so a later
				// document save asserts the post-rebind state, not a stale value.
				return {
					reboundAt: result.report.updatedAt.toISOString(),
					document: result.report.document,
					diagnostics: result.diagnostics,
					summary: result.summary,
					rebound: result.rebound
				} satisfies RebindActionResult;
			},
			(problem) => ({ message: problem.message, errors: problem.errors })
		);
	},
	remap: async ({ params, request, locals }) => {
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
		return runAction(
			async () => {
				const report = await remapField(
					params.id,
					blockId,
					dataSetId,
					expectedField,
					availableField,
					await resolveAuthorScope(locals.authorSession?.authorId)
				);
				// Return the re-resolved document AND its new `updatedAt` (Epic 10.5): the
				// editor reseeds its working copy and advances the concurrency token, so the
				// next document save asserts the post-remap state rather than spuriously 409-ing.
				return {
					remappedAt: report.updatedAt.toISOString(),
					document: report.document
				} satisfies RemapActionResult;
			},
			(problem) => ({ message: problem.message, errors: problem.errors })
		);
	},
	// FR32 stage 1: request a bounded outline (sections + key points) for review.
	// chatComplete gates on configured + opted-in, so a disabled instance returns
	// the 5.3 503 here and makes no call. The outline + its content hash are
	// returned to the client; the hash binds a later approval to THIS outline.
	'generate-outline': async ({ request, locals }) => {
		// Cost/DoS brake (5.4 QA): each generate issues a metered LLM call, so an
		// authenticated author is rate-limited per session BEFORE any chatComplete.
		const decision = aiGenerationLimiter.consume(`${locals.authorSession!.id}:/generate`);
		if (!decision.allowed) {
			const limited = rateLimited(decision.retryAfterSeconds);
			return fail(429, { generate: { message: limited.detail ?? limited.title } });
		}
		const data = await request.formData();
		const intent = String(data.get('intent') ?? '').trim();
		const skeletonId = String(data.get('skeletonId') ?? '').trim() || null;
		const dataSetId = String(data.get('dataSetId') ?? '').trim() || null;
		if (!intent) {
			return fail(400, { generate: { message: 'Describe what the report should cover.' } });
		}
		return runAction(
			async () => {
				const outline = await generateOutline(
					{
						intent,
						skeletonId,
						dataSetId,
						requestId: locals.requestId
					},
					await resolveAuthorScope(locals.authorSession?.authorId)
				);
				return {
					generate: {
						stage: 'outline' as const,
						outline,
						outlineHash: hashOutline(outline),
						skeletonId,
						dataSetId
					}
				};
			},
			(problem) => ({ generate: { message: problem.message } })
		);
	},
	// FR32 stage 2: fill the APPROVED outline into the draft. The approved outline
	// + its approval hash are posted back; fillFromOutline re-checks the hash (a
	// since-edited outline is a 409 before any LLM call), assembles a DocumentV1
	// with server-owned ids, and writes through updateReportDocument - the SAME
	// validate-on-write every surface uses. An invalid model document is the 422
	// errors[] and the draft is left untouched.
	'generate-fill': async ({ params, request, locals }) => {
		// Same cost/DoS brake as generate-outline, per author session, before any
		// chatComplete in fillFromOutline.
		const decision = aiGenerationLimiter.consume(`${locals.authorSession!.id}:/generate`);
		if (!decision.allowed) {
			const limited = rateLimited(decision.retryAfterSeconds);
			return fail(429, { generate: { message: limited.detail ?? limited.title } });
		}
		const data = await request.formData();
		const rawOutline = String(data.get('outline') ?? '');
		const approvedHash = String(data.get('outlineHash') ?? '');
		const skeletonId = String(data.get('skeletonId') ?? '').trim() || null;
		const dataSetId = String(data.get('dataSetId') ?? '').trim() || null;
		if (rawOutline.length > MAX_DOCUMENT_BYTES) {
			return fail(413, { generate: { message: 'Outline payload is too large.' } });
		}
		let outline: Outline;
		try {
			outline = JSON.parse(rawOutline) as Outline;
		} catch {
			return fail(400, { generate: { message: 'Malformed outline payload.' } });
		}
		if (!approvedHash) {
			return fail(400, { generate: { message: 'Approve the outline before generating content.' } });
		}
		return runAction(
			async () => {
				const report = await fillFromOutline(
					{
						intent: '',
						outline,
						approvedHash,
						skeletonId,
						dataSetId,
						requestId: locals.requestId
					},
					await resolveAuthorScope(locals.authorSession?.authorId),
					params.id
				);
				return {
					generate: { stage: 'filled' as const, savedAt: report.updatedAt.toISOString() }
				};
			},
			(problem) => ({ generate: { message: problem.message, errors: problem.errors } })
		);
	},
	publish: async ({ params, locals }) => {
		// A 422 (invalid draft) carries the actionable errors[]; the editor renders
		// them at the failing blocks, reusing the save-path rendering.
		return runAction(
			async () => {
				const report = await publishReport(
					params.id,
					await resolveAuthorScope(locals.authorSession?.authorId)
				);
				// Return the new `updatedAt` so the editor reseeds its concurrency token
				// from THIS result, self-contained, instead of depending on the prop
				// refreshing after invalidateAll (an ordering the callback should not lean on).
				return { published: true, status: report.status, savedAt: report.updatedAt.toISOString() };
			},
			(problem) => ({ message: problem.message, errors: problem.errors })
		);
	},
	unpublish: async ({ params, locals }) => {
		return runAction(
			async () => {
				const report = await unpublishToDraft(
					params.id,
					await resolveAuthorScope(locals.authorSession?.authorId)
				);
				// Return the new `updatedAt` so the editor reseeds its concurrency token
				// from THIS result (see the publish action note).
				return { published: false, status: report.status, savedAt: report.updatedAt.toISOString() };
			},
			(problem) => ({ message: problem.message, errors: problem.errors })
		);
	},
	logout: async ({ cookies }) => {
		await performLogout(cookies);
		redirect(303, '/login');
	}
};
