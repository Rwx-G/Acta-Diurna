import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { resolveAuthorScope } from '$lib/server/authors';
import type { ReportStatus } from '$lib/server/documents/reports';
import { getReport } from '$lib/server/documents/reports';
import { isMultiAuthor } from '$lib/server/mode';
import {
	createShare,
	listShares,
	revokeShare,
	setShareMode,
	shareUrl,
	type ShareMode,
	type ShareSummary
} from '$lib/server/sharing';
import { listRecipientsForShares, setShareRecipients } from '$lib/server/sharing';
import { isPlausibleEmail, normalizeEmail } from '$lib/server/reader';
import { AppError, errorPageShape } from '$lib/server/problem';

/** A share plus its restricted-mode recipient list (empty for open shares). */
interface ShareView extends ShareSummary {
	recipients: string[];
}

interface SharePageData {
	report: { id: string; title: string; status: ReportStatus };
	shares: ShareView[];
	/**
	 * The operating mode the UI branches on (story 8.4). MULTI (SMTP configured):
	 * the restricted/open + recipient controls render unchanged. SINGLE (no SMTP):
	 * shares are consultation tokens, so the restricted-mode and recipient-list
	 * controls are hidden and the page explains the consultation behavior.
	 */
	multi: boolean;
}

/**
 * Share management for one report (FR17/FR19/FR21, mode-aware per story 8.4).
 * Loads the report (for its publish status: a draft cannot be shared, FR6), its
 * existing shares, and - in MULTI mode - each share's recipient allow-list so the
 * restricted-mode editor can render the current list. The `create-share` action
 * mints a link and returns the RAW URL exactly once. In MULTI mode `set-mode`
 * flips a share restricted<->open and `set-recipients` replaces a restricted
 * share's allow-list (FR19); in SINGLE mode those operations are refused by the
 * service (no email to verify recipients) and the UI hides their controls.
 */
export const load: PageServerLoad = async ({ params, locals }): Promise<SharePageData> => {
	try {
		const multi = isMultiAuthor();
		const scope = await resolveAuthorScope(locals.authorSession?.authorId);
		const report = await getReport(params.id, scope);
		const summaries = await listShares(report.id, scope);
		// One batched read for every share's allow-list, not one query per share.
		// Single mode has no recipient lists, so the read is skipped entirely.
		const recipientsByShare = multi
			? await listRecipientsForShares(summaries.map((share) => share.id))
			: new Map<string, string[]>();
		const shares = summaries.map((share) => ({
			...share,
			recipients: recipientsByShare.get(share.id) ?? []
		}));
		return {
			report: { id: report.id, title: report.title, status: report.status },
			shares,
			multi
		};
	} catch (thrown) {
		if (thrown instanceof AppError) error(thrown.status, errorPageShape(thrown));
		throw thrown;
	}
};

/** Parses a textarea/CSV blob of emails into a normalized, deduped, valid list. */
function parseRecipients(raw: string): string[] {
	const candidates = raw
		.split(/[\n,;]+/)
		.map((value) => normalizeEmail(value))
		.filter((value) => value.length > 0);
	const valid = candidates.filter((value) => isPlausibleEmail(value));
	return Array.from(new Set(valid));
}

export const actions: Actions = {
	'create-share': async ({ params, request, url, locals }) => {
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

		// Single mode mints consultation tokens only (story 8.4): force `open` and
		// carry no recipient list, so the form's mode/recipient inputs (hidden in
		// the UI there) can never reach the service as a restricted request. Multi
		// mode reads the author's choice as before.
		const multi = isMultiAuthor();
		const mode: ShareMode = multi && rawMode !== 'open' ? 'restricted' : 'open';
		const recipients =
			multi && typeof data.get('recipients') === 'string'
				? parseRecipients(data.get('recipients') as string)
				: [];

		try {
			const scope = await resolveAuthorScope(locals.authorSession?.authorId);
			const { token, share } = await createShare(params.id, scope, { mode, expiresAt });
			// A restricted share with an initial recipient list set in one gesture.
			if (mode === 'restricted' && recipients.length > 0) {
				await setShareRecipients(share.id, recipients, scope);
			}
			return { created: { url: shareUrl(url.origin, token), share } };
		} catch (thrown) {
			if (thrown instanceof AppError) {
				return fail(thrown.status, { message: thrown.detail ?? thrown.title });
			}
			throw thrown;
		}
	},

	'set-mode': async ({ request, locals }) => {
		const data = await request.formData();
		const shareId = data.get('shareId');
		const rawMode = data.get('mode');
		if (typeof shareId !== 'string' || shareId.length === 0) {
			return fail(400, { message: 'Missing share.' });
		}
		const mode: ShareMode = rawMode === 'open' ? 'open' : 'restricted';
		const updated = await setShareMode(
			shareId,
			mode,
			await resolveAuthorScope(locals.authorSession?.authorId)
		);
		if (updated === 0) return fail(404, { message: 'Share not found.' });
		return { modeSet: { shareId, mode } };
	},

	'set-recipients': async ({ request, locals }) => {
		const data = await request.formData();
		const shareId = data.get('shareId');
		const raw = data.get('recipients');
		if (typeof shareId !== 'string' || shareId.length === 0) {
			return fail(400, { message: 'Missing share.' });
		}
		const recipients = typeof raw === 'string' ? parseRecipients(raw) : [];
		try {
			// setShareRecipients validates the share id (unknown/malformed/foreign -> 404)
			// and the list size (over the cap -> 422) before any write, so a stale or
			// garbage shareId is a clean fail, never a 500 from the FK or a cast error.
			await setShareRecipients(
				shareId,
				recipients,
				await resolveAuthorScope(locals.authorSession?.authorId)
			);
			return { recipientsSet: { shareId, count: recipients.length } };
		} catch (thrown) {
			if (thrown instanceof AppError) {
				return fail(thrown.status, { message: thrown.detail ?? thrown.title });
			}
			throw thrown;
		}
	},

	'revoke-share': async ({ request, locals }) => {
		const data = await request.formData();
		const shareId = data.get('shareId');
		if (typeof shareId !== 'string' || shareId.length === 0) {
			return fail(400, { message: 'Missing share.' });
		}
		// One-click, immediate, idempotent (FR20): flips revoked_at and sweeps any
		// live reader sessions. Revoking an already-revoked share is a no-op, so a
		// double-submit is harmless. revokeShare gates on ownership (story 8.2): a
		// share the author does not own is a silent no-op, never a cross-author revoke.
		await revokeShare(shareId, await resolveAuthorScope(locals.authorSession?.authorId));
		return { revoked: { shareId } };
	}
};
