import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { resolveAuthorScope } from '$lib/server/authors';
import { getSeriesDiffView, type SeriesDiffBaseline } from '$lib/server/documents/reports';
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
 * The loader does NO read of its own: {@link getSeriesDiffView} returns the issue
 * title (for the page head) and gates the draft case in the same two scoped reads the
 * diff already does, so an unpublished issue surfaces as the `not-published` state
 * the page renders as a publish-first prompt, never a raw 409 or an empty view.
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
		const view = await getSeriesDiffView(params.id, scope);
		if (view.state === 'not-published') {
			return { state: 'not-published', title: view.title };
		}
		return { state: 'ready', title: view.title, diff: view.diff, baseline: view.baseline };
	} catch (thrown) {
		if (thrown instanceof AppError) error(thrown.status, errorPageShape(thrown));
		throw thrown;
	}
};
