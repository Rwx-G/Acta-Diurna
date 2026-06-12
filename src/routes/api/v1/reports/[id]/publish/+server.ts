import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { publishReport } from '$lib/server/documents/reports';
import { runApi } from '$lib/server/api';
import { readOptionalExpectedUpdatedAt } from '../../body';

/**
 * `POST /api/v1/reports/:id/publish` - freezes the draft into the published
 * snapshot (`publishReport`, story 1.7). Validates the draft inside the service,
 * so an invalid draft surfaces the same FR2 422 the workspace publish action
 * shows; idempotent on an already-published report. An optional
 * `{ expectedUpdatedAt }` body opts into the optimistic-concurrency 409. A bare
 * POST with no body publishes without a concurrency guard.
 */
export const POST: RequestHandler = ({ params, request }) =>
	runApi(async () => {
		const expectedUpdatedAt = await readOptionalExpectedUpdatedAt(request);
		return json(await publishReport(params.id, expectedUpdatedAt));
	});
