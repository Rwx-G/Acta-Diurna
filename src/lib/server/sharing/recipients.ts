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
import { and, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db/client';
import { uuidv7 } from '$lib/server/db/ids';
import { shareRecipients } from '$lib/server/db/schema';
import { isPlausibleEmail, normalizeEmail } from '$lib/server/reader/email';
import type { ShareMode } from './shares';

/** A share's mode + id, the minimum `isAuthorizedReader` needs. */
type AuthorizableShare = { id: string; mode: ShareMode };

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
 */
export async function setShareRecipients(shareId: string, emails: string[]): Promise<void> {
	const normalized = Array.from(
		new Set(emails.map(normalizeEmail).filter((email) => isPlausibleEmail(email)))
	);

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
