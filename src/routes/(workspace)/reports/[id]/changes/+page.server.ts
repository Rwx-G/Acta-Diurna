import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { resolveAuthorScope } from '$lib/server/authors';
import {
	getReport,
	getSeriesDiffView,
	type SeriesDiffBaseline
} from '$lib/server/documents/reports';
import type { SeriesDiff } from '$lib/schema';
import { AppError, errorPageShape } from '$lib/server/problem';

/**
 * Workspace "what changed since last issue" loader (Story 9.3): the AUTHOR-facing
 * payoff of the series diff engine. A WORKSPACE route behind the auth guard and
 * owner-scoped via the Epic 8 author scope - {@link getSeriesDiffView} ANDs the
 * owner predicate on every read it composes, so a non-owner or unknown id raises the
 * SAME neutral 404 with no existence oracle (story 8.2 tenancy).
 *
 * The diff is the typed {@link SeriesDiff} from the engine: a computed `diff` (the
 * per-section, per-block changelog), or one of two neutral states - `no-predecessor`
 * (a first issue or an unpublished predecessor) and `substantial-drift` (the two
 * editions share almost no block ids). The view renders the neutral states on the
 * `kind` discriminant; the `baseline` labels a computed diff with the predecessor's
 * cosmetic display identity (its title, `issueLabel`, and publish date).
 *
 * NO LEAK by construction: the engine returns only structural / data / content
 * CHANGE FLAGS plus section/block ids, titles, and types - never speaker notes, never
 * a prior-issue block body. The baseline carries the predecessor's display labels
 * only. So this loader cannot serialize an author-private field or any raw
 * prior-issue content: the heavy document columns never reach this seam.
 *
 * An unpublished issue (no frozen edition to compare) raises the same 409 the rest
 * of the diff path raises; the page maps it to a clear "publish first" state rather
 * than an empty view.
 */
export const load: PageServerLoad = async ({
	params,
	locals
}): Promise<
	| { state: 'ready'; title: string; diff: SeriesDiff; baseline: SeriesDiffBaseline | null }
	| { state: 'not-published'; title: string }
> => {
	try {
		const scope = await resolveAuthorScope(locals.authorSession?.authorId);
		const report = await getReport(params.id, scope);
		if (report.status !== 'published' || report.publishedDocument === null) {
			return { state: 'not-published', title: report.title };
		}
		const view = await getSeriesDiffView(params.id, scope);
		return { state: 'ready', title: report.title, diff: view.diff, baseline: view.baseline };
	} catch (thrown) {
		if (thrown instanceof AppError) error(thrown.status, errorPageShape(thrown));
		throw thrown;
	}
};
