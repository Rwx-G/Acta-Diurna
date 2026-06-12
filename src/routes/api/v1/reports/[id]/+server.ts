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
 * to `updateReportTitle` - the same granular documents services (validate-on-write),
 * composed to match the workspace's behavior, so validation, the published-read-only
 * rule, and the FR2 422 problem+json are identical (workspace parity).
 * `expectedUpdatedAt` opts into optimistic concurrency: a stale token is the
 * service's 409 `/problems/report-conflict`.
 *
 * The report title is canonically `document.title` (the documents service derives
 * the row title from it), so when both `title` and `document` are present we set
 * `document.title = title` and do a SINGLE guarded `updateReportDocument` write.
 * That keeps the whole update atomic under one concurrency guard - a separate
 * unguarded title write would let a concurrent edit slip in between and be
 * silently overwritten. Precedence: the explicit `title` arg wins over any
 * `document.title` already in the body when they differ. At least one of the two
 * must be present.
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
		if (hasTitle && typeof body['title'] !== 'string') {
			throw new AppError({
				status: 400,
				title: 'Malformed request body',
				type: '/problems/malformed-request',
				detail: '`title` must be a string.'
			});
		}

		if (hasDocument && hasTitle) {
			const document = { ...(body['document'] as Record<string, unknown>), title: body['title'] };
			return json(await updateReportDocument(params.id, document, expectedUpdatedAt));
		}
		if (hasDocument) {
			return json(await updateReportDocument(params.id, body['document'], expectedUpdatedAt));
		}
		return json(await updateReportTitle(params.id, body['title'] as string));
	});

/** `DELETE /api/v1/reports/:id` - 204; the service 409s a published (non-draft) report. */
export const DELETE: RequestHandler = ({ params }) =>
	runApi(async () => {
		await deleteDraft(params.id);
		return new Response(null, { status: 204 });
	});
