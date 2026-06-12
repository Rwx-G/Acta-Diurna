import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createReport, createReportWithDocument, listReports } from '$lib/server/documents/reports';
import { AppError } from '$lib/server/problem';
import { DEFAULT_REPORT_TITLE } from '$lib/server/documents/defaults';
import { runApi } from '$lib/server/api';
import { readJsonObject } from './body';

/**
 * `GET /api/v1/reports` - lists every report (newest first), the SAME projection
 * the workspace reports list renders (`listReports`, story 1.5). Returns a
 * `{ items }` envelope (backlog Epic 4 decision): an envelope from day one leaves
 * room for `total`/pagination later without a breaking response-shape change a
 * bare array would force on agents.
 */
export const GET: RequestHandler = () => runApi(async () => json({ items: await listReports() }));

/**
 * `POST /api/v1/reports` - creates a draft report (201). With a `document` in the
 * body it instantiates that document (`createReportWithDocument`, the skeleton
 * path); without one it seeds the blank starter (`createReport`) with an optional
 * `title`. Both go through validate-on-write IN the service, so an invalid
 * document throws the FR2 422 problem+json (block path/field/hint) the workspace
 * produces - the route adds no validation of its own (workspace parity).
 */
export const POST: RequestHandler = ({ request }) =>
	runApi(async () => {
		const body = await readJsonObject(request);

		if (body['document'] !== undefined) {
			const report = await createReportWithDocument(body['document']);
			return json(report, { status: 201 });
		}

		const rawTitle = body['title'];
		if (rawTitle !== undefined && typeof rawTitle !== 'string') {
			throw new AppError({
				status: 400,
				title: 'Malformed request body',
				type: '/problems/malformed-request',
				detail: '`title` must be a string.'
			});
		}
		const report = await createReport(rawTitle ?? DEFAULT_REPORT_TITLE);
		return json(report, { status: 201 });
	});
