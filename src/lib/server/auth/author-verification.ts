/**
 * Author magic-link verification-token store (Epic 8, story 8.3). The author-realm
 * parallel of the reader `verification_tokens` store, kept PHYSICALLY SEPARATE so
 * the realms never blur (NFR12): an author token is bound to the requesting EMAIL
 * ALONE (no share - an author signs in to the whole workspace, not to one report),
 * so it has no share id to resolve and can never verify a reader share, and a
 * reader token (share-bound) can never open an author session. The two stores are
 * different tables consumed by different functions.
 *
 *   - Single-use: `consumed_at` flips on the first valid click; a second click
 *     finds it consumed and is rejected (the neutral "request a new link" path).
 *   - 15-minute TTL: `expires_at` is set at creation; an elapsed token is dead.
 *   - Email binding: the clicked link verifies the email it was issued to.
 *
 * The raw 256-bit token reaches the caller once (it goes into the emailed URL);
 * only its SHA-256 hash is stored (shared at-rest helper), so a DB leak exposes
 * no usable link.
 */
import { randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb } from '$lib/server/db/client';
import { uuidv7 } from '$lib/server/db/ids';
import { hashToken } from '$lib/server/crypto/hash-token';
import { authorVerificationTokens } from '$lib/server/db/schema';

/** Author verification tokens live 15 minutes, matching the reader flow (NFR6). */
export const AUTHOR_VERIFICATION_TOKEN_TTL_MS: number = 15 * 60 * 1000;

const TOKEN_BYTES = 32;

export interface IssuedAuthorVerification {
	/** Raw token - goes only into the magic-link URL, never stored or logged. */
	token: string;
	expiresAt: Date;
}

/**
 * Issues an author verification token for `email`. The email must already be
 * normalized by the caller (boundary concern, see reader/email.ts). Returns the
 * raw token once; only its hash is persisted.
 */
export async function issueAuthorVerificationToken(
	email: string
): Promise<IssuedAuthorVerification> {
	const token = randomBytes(TOKEN_BYTES).toString('base64url');
	const expiresAt = new Date(Date.now() + AUTHOR_VERIFICATION_TOKEN_TTL_MS);

	await getDb()
		.insert(authorVerificationTokens)
		.values({
			id: uuidv7(),
			tokenHash: hashToken(token),
			email,
			expiresAt
		});

	return { token, expiresAt };
}

/**
 * Reports whether a LIVE (unconsumed, unexpired) author verification token already
 * exists for `email`. Used by the gate to dedup before issuing: an email is capped
 * to one pending verification within the 15-min TTL, so an attacker cannot amplify
 * mail to a victim address by repeating the request - the victim is emailed at most
 * once per TTL window, regardless of request volume.
 *
 * The email must already be normalized by the caller (boundary concern).
 */
export async function hasLiveAuthorVerification(email: string): Promise<boolean> {
	const rows = await getDb()
		.select({ id: authorVerificationTokens.id })
		.from(authorVerificationTokens)
		.where(
			and(
				eq(authorVerificationTokens.email, email),
				isNull(authorVerificationTokens.consumedAt),
				gt(authorVerificationTokens.expiresAt, new Date())
			)
		)
		.limit(1);
	return rows.length > 0;
}

/**
 * Reports whether an author verification token is LIVE (exists, unconsumed,
 * unexpired) WITHOUT consuming it - a read-only SELECT, the peek the POST-to-consume
 * interstitial needs (A1 mitigation). A mail-gateway link scanner GET-prefetches the
 * emailed link; the landing peeks (this), so a prefetch never burns the token, and
 * the human's "Confirm sign-in" POST still consumes it for real. A zero-row result
 * (unknown, already consumed, or expired) returns false, all indistinguishable to
 * the caller, by design (the same neutral "request a new link" path, no enumeration
 * of which cause). This never flips `consumed_at`, so a peek is safe to repeat.
 */
export async function peekAuthorVerificationToken(rawToken: string): Promise<boolean> {
	const tokenHash = hashToken(rawToken);
	const rows = await getDb()
		.select({ id: authorVerificationTokens.id })
		.from(authorVerificationTokens)
		.where(
			and(
				eq(authorVerificationTokens.tokenHash, tokenHash),
				isNull(authorVerificationTokens.consumedAt),
				gt(authorVerificationTokens.expiresAt, new Date())
			)
		)
		.limit(1);
	return rows.length > 0;
}

/**
 * Consumes an author verification token, atomically marking it used so a concurrent
 * or replayed second click cannot also succeed (single-use). The consume is an
 * UPDATE guarded by `consumed_at IS NULL`; a zero-row result means the token was
 * unknown, already consumed, or expired - all indistinguishable to the caller, by
 * design (the neutral "request a new link" path, no enumeration of which cause).
 *
 * Returns the bound email on success, or null on any failure.
 */
export async function consumeAuthorVerificationToken(rawToken: string): Promise<string | null> {
	const now = new Date();
	const tokenHash = hashToken(rawToken);

	// Single round-trip, single-use guarantee: UPDATE ... WHERE consumed_at IS
	// NULL returns the row only for the first caller; a racing second click sees
	// zero rows. drizzle's `returning()` gives us the bound email and expiry
	// (typed as the full table row) without a second read.
	const updated = await getDb()
		.update(authorVerificationTokens)
		.set({ consumedAt: now })
		.where(
			and(
				eq(authorVerificationTokens.tokenHash, tokenHash),
				isNull(authorVerificationTokens.consumedAt)
			)
		)
		.returning();

	const row = updated[0];
	if (!row) return null;
	// Expiry is checked AFTER the atomic claim: the row is now consumed either way
	// (a click on an expired token still burns it), but an elapsed token does not
	// verify.
	if (row.expiresAt.getTime() <= now.getTime()) return null;

	return row.email;
}
