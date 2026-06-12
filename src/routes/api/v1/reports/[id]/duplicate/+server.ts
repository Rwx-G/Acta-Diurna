import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { duplicateReport } from '$lib/server/documents/reports';
import { runApi } from '$lib/server/api';

/**
 * `POST /api/v1/reports/:id/duplicate` - mints a fresh draft from a deep copy of
 * the source report (`duplicateReport`, FR10), the SAME service the workspace
 * Duplicate action calls. Returns the new draft with 201, the same created-
 * resource envelope `POST /api/v1/reports` uses (the bare report resource, not a
 * wrapper). The service 404s an unknown/malformed id; a published source is
 * duplicated into an editable draft like any other (no 409 here - duplicating is
 * status-agnostic). No request body.
 */
export const POST: RequestHandler = ({ params }) =>
	runApi(async () => json(await duplicateReport(params.id), { status: 201 }));
