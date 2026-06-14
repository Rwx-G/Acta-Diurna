import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { listAccessRecords, listOwnedReportOptions } from '$lib/server/audit/access-log';
import { performLogout } from '$lib/server/auth/logout';
import { resolveAuthorScope } from '$lib/server/authors';

/**
 * Access-audit view (story 6.3, FR24). Author-only and owner-scoped: the load
 * resolves the logged-in author's scope and reads ONLY accesses to that author's
 * reports. The report and reader filters come from the query string (`?report=`,
 * `?reader=`); a cross-owner or malformed id falls through to an empty result in
 * the query, never a leak or an error. The report-filter options are the author's
 * own reports, so the dropdown itself never names another author's report.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const scope = await resolveAuthorScope(locals.authorSession?.authorId);
	const reportId = url.searchParams.get('report') ?? undefined;
	const readerId = url.searchParams.get('reader') ?? undefined;
	// The cursor carries the keyset position of the last row of the previous page;
	// "load older" submits it as `?cursor=`. An absent or malformed cursor starts
	// from the newest access (the query treats a bad cursor as the top).
	const cursor = url.searchParams.get('cursor') ?? undefined;

	const [page, reportOptions] = await Promise.all([
		listAccessRecords(scope, { reportId, readerId }, { cursor }),
		listOwnedReportOptions(scope)
	]);

	return {
		accesses: page.items.map((entry) => ({
			id: entry.id,
			reportId: entry.reportId,
			reportTitle: entry.reportTitle,
			readerIdentityId: entry.readerIdentityId,
			readerEmail: entry.readerEmail,
			accessedAt: entry.accessedAt
		})),
		// Non-null when older accesses remain: the view turns it into a "Load older"
		// affordance so the trail is never silently cut off at the page boundary.
		nextCursor: page.nextCursor,
		reportOptions,
		filter: { reportId: reportId ?? '', readerId: readerId ?? '' }
	};
};

export const actions: Actions = {
	logout: async ({ cookies }) => {
		await performLogout(cookies);
		redirect(303, '/login');
	}
};
