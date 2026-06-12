/**
 * Restricted-share recipient allow-list (FR19, story 3.4). A `restricted` share
 * authorizes only the emails on its list; an `open` share has no list and admits
 * any verified email. The membership check (`isAuthorizedReader`) is consumed by
 * the reader gate BEHIND the neutral confirmation, so an off-list email is never
 * distinguishable from an on-list one (NFR9 enumeration-safety).
 *
 * Emails are normalized (lowercased/trimmed) with the SAME boundary helper the
 * reader identity/verification path uses (`reader/email.ts`), so the allow-list,
 * the verification token binding, and the identity row all key on one canonical
 * form: `Foo@X.com` written to the list authorizes `foo@x.com` at verification.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '$lib/server/db/client';
import { uuidv7 } from '$lib/server/db/ids';
import { shareRecipients, shares } from '$lib/server/db/schema';
import { AppError } from '$lib/server/problem';
import { isPlausibleEmail, normalizeEmail } from '$lib/server/reader/email';
import type { ShareMode } from './shares';

/** A share's mode + id, the minimum `isAuthorizedReader` needs. */
type AuthorizableShare = { id: string; mode: ShareMode };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Upper bound on the effective (normalized + deduped) size of a share's
 * allow-list. The management UI submits a free-text blob that splits into
 * arbitrarily many rows, so without a cap a single submission could insert an
 * unbounded set in one transaction - a storage/DoS footgun even in the V1
 * author realm. 500 distinct recipients per share is well past any realistic
 * distribution list while still bounding the write.
 */
export const MAX_SHARE_RECIPIENTS = 500;

/** 404 for an unknown/malformed share id - mirrors the reports/skeletons boundary. */
function shareNotFound(): AppError {
	return new AppError({
		status: 404,
		title: 'Share not found',
		type: '/problems/share-not-found',
		detail: 'This share does not exist.'
	});
}

/** Whether a share row exists for `shareId` (a malformed id can never match). */
async function shareExists(shareId: string): Promise<boolean> {
	if (!UUID_PATTERN.test(shareId)) return false;
	const rows = await getDb()
		.select({ id: shares.id })
		.from(shares)
		.where(eq(shares.id, shareId))
		.limit(1);
	return rows.length > 0;
}

/**
 * Replaces a share's recipient allow-list with `emails`. Each email is
 * normalized (the shared boundary helper) and de-duplicated; a malformed shape
 * is dropped silently (the management UI validates shape, this is the storage
 * guard). The replace is a delete-then-insert so the list always reflects
 * exactly what the author submitted - removing an email revokes its future
 * authorization (already-verified sessions are swept on revoke in 3.5).
 *
 * Open shares can carry a list too (it is simply ignored while the mode is
 * `open`), so switching back to restricted restores a previously-set list; the
 * caller decides whether to clear it.
 *
 * Boundary checks before any write: an unknown or malformed `shareId` is a 404
 * (never an FK/cast error surfaced as a 500), and a list whose effective size
 * exceeds `MAX_SHARE_RECIPIENTS` is a 422 - both enforced in the service so they
 * hold regardless of caller. The cap is counted AFTER normalization+dedup, on
 * the actual row count that would be inserted.
 */
export async function setShareRecipients(shareId: string, emails: string[]): Promise<void> {
	const normalized = Array.from(
		new Set(emails.map(normalizeEmail).filter((email) => isPlausibleEmail(email)))
	);

	if (normalized.length > MAX_SHARE_RECIPIENTS) {
		throw new AppError({
			status: 422,
			title: 'Too many recipients',
			type: '/problems/share-recipients-limit',
			detail: `A share allow-list is limited to ${MAX_SHARE_RECIPIENTS} recipients.`
		});
	}

	if (!(await shareExists(shareId))) throw shareNotFound();

	const db = getDb();
	await db.transaction(async (tx) => {
		await tx.delete(shareRecipients).where(eq(shareRecipients.shareId, shareId));
		if (normalized.length === 0) return;
		await tx.insert(shareRecipients).values(
			normalized.map((email) => ({
				id: uuidv7(),
				shareId,
				email
			}))
		);
	});
}

/** Lists a share's normalized recipient emails, ascending, for the management UI. */
export async function listShareRecipients(shareId: string): Promise<string[]> {
	const rows = await getDb()
		.select({ email: shareRecipients.email })
		.from(shareRecipients)
		.where(eq(shareRecipients.shareId, shareId))
		.orderBy(shareRecipients.email);
	return rows.map((row) => row.email);
}

/**
 * Batched recipient lookup for many shares in one query (the management load
 * renders every share's allow-list at once). A single `WHERE share_id IN (...)`
 * replaces one query per share (N+1), then groups the rows by share id in JS.
 * Each share's emails come back ascending, and a share with no recipients maps
 * to an empty array so the caller can index every id unconditionally. An empty
 * `shareIds` short-circuits to an empty map without touching the database.
 */
export async function listRecipientsForShares(shareIds: string[]): Promise<Map<string, string[]>> {
	const grouped = new Map<string, string[]>(shareIds.map((id) => [id, []]));
	if (shareIds.length === 0) return grouped;

	const rows = await getDb()
		.select({ shareId: shareRecipients.shareId, email: shareRecipients.email })
		.from(shareRecipients)
		.where(inArray(shareRecipients.shareId, shareIds))
		.orderBy(shareRecipients.email);

	for (const row of rows) {
		const emails = grouped.get(row.shareId);
		if (emails) emails.push(row.email);
	}
	return grouped;
}

/**
 * Whether `email` may verify against this share (FR19).
 *
 *   - `open` mode: always true. Any holder of the link who verifies their email
 *     may read; the allow-list is irrelevant, so no DB read happens.
 *   - `restricted` mode: true iff the normalized email has a row in the share's
 *     allow-list.
 *
 * The email MUST already be normalized by the caller (the gate normalizes at the
 * boundary). The restricted lookup keys on the unique (share, email) index, so a
 * `Foo@X.com` list entry authorizes a `foo@x.com` request.
 *
 * This predicate is the membership half of the enumeration-safe gate: its result
 * decides whether a token is issued, but it sits BEHIND the neutral confirmation,
 * never in front of it - the caller's response is identical either way.
 */
export async function isAuthorizedReader(
	share: AuthorizableShare,
	normalizedEmail: string
): Promise<boolean> {
	if (share.mode === 'open') return true;

	const rows = await getDb()
		.select({ id: shareRecipients.id })
		.from(shareRecipients)
		.where(and(eq(shareRecipients.shareId, share.id), eq(shareRecipients.email, normalizedEmail)))
		.limit(1);
	return rows.length > 0;
}
