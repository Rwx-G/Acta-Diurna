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

	const [accesses, reportOptions] = await Promise.all([
		listAccessRecords(scope, { reportId, readerId }),
		listOwnedReportOptions(scope)
	]);

	return {
		accesses: accesses.map((entry) => ({
			id: entry.id,
			reportId: entry.reportId,
			reportTitle: entry.reportTitle,
			readerIdentityId: entry.readerIdentityId,
			readerEmail: entry.readerEmail,
			accessedAt: entry.accessedAt
		})),
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
