import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveApiAuthorScope } from '$lib/server/authors';
import { createReport, createReportWithDocument, listReports } from '$lib/server/documents/reports';
import { AppError } from '$lib/server/problem';
import { DEFAULT_REPORT_TITLE } from '$lib/server/documents/defaults';
import { runApi } from '$lib/server/api';
import { readJsonObject } from './body';

/**
 * `GET /api/v1/reports` - lists a page of reports (newest first), the SAME
 * projection the workspace reports list renders (`listReports`, story 1.5).
 * Keyset (cursor) paginated: `?cursor=` resumes after a prior page and `?limit=`
 * sets the page size (clamped server-side). Returns a `{ items, nextCursor }`
 * envelope; `nextCursor` is null on the last page, a cursor to pass back as
 * `?cursor=` otherwise (the contract frozen by full-audit C2 - an envelope that
 * already carried the items wrapper now carries the page cursor too, no break).
 */
export const GET: RequestHandler = ({ locals, url }) =>
	runApi(async () => {
		const cursor = url.searchParams.get('cursor') ?? undefined;
		const rawLimit = url.searchParams.get('limit');
		const limit = rawLimit !== null ? Number(rawLimit) : undefined;
		const page = await listReports(await resolveApiAuthorScope(locals.apiIdentity!), {
			cursor,
			limit
		});
		return json({ items: page.items, nextCursor: page.nextCursor });
	});

/**
 * `POST /api/v1/reports` - creates a draft report (201). With a `document` in the
 * body it instantiates that document (`createReportWithDocument`, the skeleton
 * path); without one it seeds the blank starter (`createReport`) with an optional
 * `title`. Both go through validate-on-write IN the service, so an invalid
 * document throws the FR2 422 problem+json (block path/field/hint) the workspace
 * produces - the route adds no validation of its own (workspace parity).
 */
export const POST: RequestHandler = ({ request, locals }) =>
	runApi(async () => {
		const body = await readJsonObject(request);
		const scope = await resolveApiAuthorScope(locals.apiIdentity!);

		if (body['document'] !== undefined) {
			const report = await createReportWithDocument(body['document'], scope);
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
		const report = await createReport(rawTitle ?? DEFAULT_REPORT_TITLE, scope);
		return json(report, { status: 201 });
	});
