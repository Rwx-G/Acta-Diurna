import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	deleteDraft,
	getReport,
	updateReportDocument,
	updateReportTitle
} from '$lib/server/documents/reports';
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
 * to `updateReportTitle` - the EXACT services the workspace editor calls, so
 * validation, the published-read-only rule, and the FR2 422 problem+json are
 * identical (workspace parity). `expectedUpdatedAt` opts into optimistic
 * concurrency: a stale token is the service's 409 `/problems/report-conflict`.
 *
 * `document` is applied before `title` when both are present, so the final row
 * reflects the explicit title rather than the document's own. At least one of the
 * two must be present.
 */
export const PATCH: RequestHandler = ({ params, request }) =>
	runApi(async () => {
		const body = await readJsonObject(request);
		const expectedUpdatedAt = readExpectedUpdatedAt(body);

		const hasDocument = body['document'] !== undefined;
		const hasTitle = body['title'] !== undefined;
		if (!hasDocument && !hasTitle) {
			throw new AppError({
				status: 400,
				title: 'Empty update',
				type: '/problems/malformed-request',
				detail: 'Provide at least one of `title` or `document` to update.'
			});
		}

		let report;
		if (hasDocument) {
			report = await updateReportDocument(params.id, body['document'], expectedUpdatedAt);
		}
		if (hasTitle) {
			if (typeof body['title'] !== 'string') {
				throw new AppError({
					status: 400,
					title: 'Malformed request body',
					type: '/problems/malformed-request',
					detail: '`title` must be a string.'
				});
			}
			report = await updateReportTitle(params.id, body['title']);
		}

		return json(report);
	});

/** `DELETE /api/v1/reports/:id` - 204; the service 409s a published (non-draft) report. */
export const DELETE: RequestHandler = ({ params }) =>
	runApi(async () => {
		await deleteDraft(params.id);
		return new Response(null, { status: 204 });
	});
