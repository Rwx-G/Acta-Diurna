import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteDraft, getReport } from '$lib/server/documents/reports';
import { composeReportUpdate } from '$lib/server/documents/update-composition';
import { AppError } from '$lib/server/problem';
import { runApi } from '$lib/server/api';
import { readExpectedUpdatedAt, readJsonObject } from '../body';

/** `GET /api/v1/reports/:id` - one report; the service 404s an unknown/malformed id. */
export const GET: RequestHandler = ({ params }) =>
	runApi(async () => json(await getReport(params.id)));

/**
 * `PATCH /api/v1/reports/:id` - partial update (backlog Epic 4 decision: PATCH,
 * not PUT, since the services are granular). Body `{ title?, document?,
 * expectedUpdatedAt? }`: a `document` routes to `updateReportDocument`, a `title`
 * to `updateReportTitle` - the same granular documents services (validate-on-write),
 * composed to match the workspace's behavior, so validation, the published-read-only
 * rule, and the FR2 422 problem+json are identical (workspace parity).
 * `expectedUpdatedAt` opts into optimistic concurrency: a stale token is the
 * service's 409 `/problems/report-conflict`.
 *
 * The composition (combined `{title, document}` -> a single guarded
 * `updateReportDocument` write with `document.title = title`; the explicit title
 * wins) lives in the shared `composeReportUpdate` helper so the MCP `update_report`
 * tool (story 5.2) and this route cannot drift - the route only parses transport.
 * At least one of `title`/`document` must be present (the helper 400s otherwise).
 */
export const PATCH: RequestHandler = ({ params, request }) =>
	runApi(async () => {
		const body = await readJsonObject(request);
		const expectedUpdatedAt = readExpectedUpdatedAt(body);

		if (body['title'] !== undefined && typeof body['title'] !== 'string') {
			throw new AppError({
				status: 400,
				title: 'Malformed request body',
				type: '/problems/malformed-request',
				detail: '`title` must be a string.'
			});
		}

		return json(
			await composeReportUpdate({
				id: params.id,
				title: body['title'] as string | undefined,
				document: body['document'],
				expectedUpdatedAt
			})
		);
	});

/** `DELETE /api/v1/reports/:id` - 204; the service 409s a published (non-draft) report. */
export const DELETE: RequestHandler = ({ params }) =>
	runApi(async () => {
		await deleteDraft(params.id);
		return new Response(null, { status: 204 });
	});
