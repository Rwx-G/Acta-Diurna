/**
 * Reader verification-token store (FR18 / AR6 / NFR6). A verification token is a
 * single-use, 15-minute-TTL bearer credential bound to BOTH a share and the
 * email that requested it:
 *
 *   - Single-use: `consumed_at` flips on the first valid click; a second click
 *     finds it consumed and is rejected (the neutral "request a new link" path).
 *   - 15-minute TTL: `expires_at` is set at creation; an elapsed token is dead.
 *   - Email + share binding: the clicked link verifies the email it was issued
 *     to, for the share it was issued for - forwarding the raw link does not let
 *     a different address slip past (load-bearing for 3.4 restricted mode) and a
 *     token for share A never verifies share B.
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
import { verificationTokens, type VerificationTokenRow } from '$lib/server/db/schema';

/** Verification tokens live 15 minutes (FR18/AR6). */
export const VERIFICATION_TOKEN_TTL_MS: number = 15 * 60 * 1000;

const TOKEN_BYTES = 32;

export interface IssuedVerification {
	/** Raw token - goes only into the magic-link URL, never stored or logged. */
	token: string;
	expiresAt: Date;
}

/** A consumed verification, returning the binding the session/audit step needs. */
export interface ConsumedVerification {
	shareId: string;
	email: string;
}

/**
 * Issues a verification token for (share, email). The email must already be
 * normalized by the caller (boundary concern, see `email.ts`). Returns the raw
 * token once; only its hash is persisted.
 */
export async function issueVerificationToken(
	shareId: string,
	email: string
): Promise<IssuedVerification> {
	const token = randomBytes(TOKEN_BYTES).toString('base64url');
	const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);

	await getDb()
		.insert(verificationTokens)
		.values({
			id: uuidv7(),
			tokenHash: hashToken(token),
			shareId,
			email,
			expiresAt
		});

	return { token, expiresAt };
}

/**
 * Reports whether a LIVE (unconsumed, unexpired) verification token already
 * exists for (shareId, email). Used by the gate to dedup before issuing: a
 * (share, email) pair is capped to one pending verification within the 15-min
 * TTL, so an attacker holding one open-mode share link cannot amplify mail to a
 * victim address by repeating the request - the victim is emailed at most once
 * per TTL window per share, regardless of request volume.
 *
 * The email must already be normalized by the caller (boundary concern). The
 * query keys on (share, email) - the same binding `issueVerificationToken`
 * writes - plus `consumed_at IS NULL` and a live `expires_at`.
 */
export async function hasLiveVerification(shareId: string, email: string): Promise<boolean> {
	const rows = await getDb()
		.select({ id: verificationTokens.id })
		.from(verificationTokens)
		.where(
			and(
				eq(verificationTokens.shareId, shareId),
				eq(verificationTokens.email, email),
				isNull(verificationTokens.consumedAt),
				gt(verificationTokens.expiresAt, new Date())
			)
		)
		.limit(1);
	return rows.length > 0;
}

/**
 * Reports whether a verification token is LIVE for a SPECIFIC share (exists, bound
 * to this share, unconsumed, unexpired) WITHOUT consuming it - a read-only SELECT,
 * the peek the POST-to-consume interstitial needs (A1 mitigation). A mail-gateway
 * link scanner GET-prefetches the emailed link; the landing peeks (this), so a
 * prefetch never burns the token, and the human's "Confirm and view report" POST
 * still consumes it for real. A zero-row result (unknown, already consumed,
 * expired, or bound to another share) returns false, all indistinguishable to the
 * caller, by design (the same neutral "request a new link" path). The share id is
 * part of the WHERE, mirroring the consume, so a peek for share A never reports a
 * token bound to share B as live. This never flips `consumed_at`, so it is safe to
 * repeat.
 */
export async function peekVerificationToken(rawToken: string, shareId: string): Promise<boolean> {
	const tokenHash = hashToken(rawToken);
	const rows = await getDb()
		.select({ id: verificationTokens.id })
		.from(verificationTokens)
		.where(
			and(
				eq(verificationTokens.tokenHash, tokenHash),
				eq(verificationTokens.shareId, shareId),
				isNull(verificationTokens.consumedAt),
				gt(verificationTokens.expiresAt, new Date())
			)
		)
		.limit(1);
	return rows.length > 0;
}

/**
 * Consumes a verification token for a SPECIFIC share, atomically marking it used
 * so a concurrent or replayed second click cannot also succeed (single-use). The
 * consume is an UPDATE guarded by `consumed_at IS NULL` + matching share + live
 * expiry; a zero-row result means the token was unknown, already consumed,
 * expired, or bound to another share - all indistinguishable to the caller, by
 * design (the neutral "request a new link" path, no enumeration of which cause).
 *
 * Returns the binding (share + email) on success, or null on any failure. The
 * share id is part of the WHERE so a token for share A cannot verify share B
 * even though the token hash is globally unique.
 */
export async function consumeVerificationToken(
	rawToken: string,
	shareId: string
): Promise<ConsumedVerification | null> {
	const now = new Date();
	const tokenHash = hashToken(rawToken);

	// Single round-trip, single-use guarantee: UPDATE ... WHERE consumed_at IS
	// NULL returns the row only for the first caller; a racing second click sees
	// zero rows. drizzle's `returning()` gives us the bound email without a
	// second read.
	const updated = (await getDb()
		.update(verificationTokens)
		.set({ consumedAt: now })
		.where(
			and(
				eq(verificationTokens.tokenHash, tokenHash),
				eq(verificationTokens.shareId, shareId),
				isNull(verificationTokens.consumedAt)
			)
		)
		.returning()) as VerificationTokenRow[];

	const row = updated[0];
	if (!row) return null;
	// Expiry is checked AFTER the atomic claim: the row is now consumed either
	// way (a click on an expired token still burns it), but an elapsed token does
	// not verify.
	if (row.expiresAt.getTime() <= now.getTime()) return null;

	return { shareId: row.shareId, email: row.email };
}
