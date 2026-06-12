import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { ReportStatus } from '$lib/server/documents/reports';
import { getReport } from '$lib/server/documents/reports';
import { createShare, listShares, shareUrl, type ShareSummary } from '$lib/server/sharing';
import { AppError, errorPageShape } from '$lib/server/problem';

interface SharePageData {
	report: { id: string; title: string; status: ReportStatus };
	shares: ShareSummary[];
}

/**
 * Share management for one report (FR17/FR21). Loads the report (for its
 * publish status: a draft cannot be shared, FR6) and its existing shares. The
 * `create-share` action mints a link and returns the RAW URL exactly once - the
 * raw token is never persisted and never reloaded, so the page surfaces it on
 * the action result and on nothing else.
 */
export const load: PageServerLoad = async ({ params }): Promise<SharePageData> => {
	try {
		const report = await getReport(params.id);
		return {
			report: { id: report.id, title: report.title, status: report.status },
			shares: await listShares(report.id)
		};
	} catch (thrown) {
		if (thrown instanceof AppError) error(thrown.status, errorPageShape(thrown));
		throw thrown;
	}
};

export const actions: Actions = {
	'create-share': async ({ params, request, url }) => {
		const data = await request.formData();
		const rawExpiry = data.get('expiresAt');
		const rawMode = data.get('mode');

		let expiresAt: Date | null = null;
		if (typeof rawExpiry === 'string' && rawExpiry.trim() !== '') {
			// <input type="datetime-local"> posts `YYYY-MM-DDTHH:MM` (local wall clock,
			// no zone). The format is matched strictly first - V8's Date parser is
			// lenient enough to read garbage like `not-a-date:00Z` as a real date, so
			// a regex is the actual validation. We then read it as UTC so the stored
			// instant matches the author's chosen clock regardless of host timezone
			// (the field is labelled "UTC").
			const wallClock = rawExpiry.trim();
			if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wallClock)) {
				return fail(400, { message: 'The expiry date is not a valid date and time.' });
			}
			const parsed = new Date(`${wallClock}:00Z`);
			if (Number.isNaN(parsed.getTime())) {
				return fail(400, { message: 'The expiry date is not a valid date and time.' });
			}
			expiresAt = parsed;
		}

		const mode = rawMode === 'open' ? 'open' : 'restricted';

		try {
			const { token, share } = await createShare(params.id, { mode, expiresAt });
			return { created: { url: shareUrl(url.origin, token), share } };
		} catch (thrown) {
			if (thrown instanceof AppError) {
				return fail(thrown.status, { message: thrown.detail ?? thrown.title });
			}
			throw thrown;
		}
	}
};
