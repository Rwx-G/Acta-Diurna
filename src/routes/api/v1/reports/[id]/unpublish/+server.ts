import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { unpublishToDraft } from '$lib/server/documents/reports';
import { runApi } from '$lib/server/api';

/**
 * `POST /api/v1/reports/:id/unpublish` - reverts a published report to an
 * editable draft and clears its snapshot (`unpublishToDraft`, story 1.7).
 * Idempotent on a draft. The service takes no concurrency token (reverting to
 * draft is not a lost-update hazard), so no body is read.
 */
export const POST: RequestHandler = ({ params }) =>
	runApi(async () => json(await unpublishToDraft(params.id)));
