/**
 * Sharing service (FR17/FR21/NFR6). A share is a high-entropy link to a
 * published report with an optional author-chosen expiry. The raw token is
 * minted here and returned ONCE (it goes into the share URL); only its SHA-256
 * hash is persisted (D5, the 1.4 session hash-at-rest model). Sharing is gated
 * on the publish lifecycle: `createShare` reuses 1.7's `assertShareable`, so a
 * draft is refused before any token is generated (FR6).
 *
 * The read side (`listShares`, `getShareByToken`) never exposes the raw token -
 * it does not exist after creation. `getShareByToken` reports a share's status
 * (active / expired / revoked) so the reader gate (story 3.3) and the
 * revocation/expiry neutral page (story 3.5) build on one status function; this
 * story does NOT yet enforce that status at the route.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import { destroyReaderSessionsForShare } from '$lib/server/auth/sessions';
import { getDb } from '$lib/server/db/client';
import { uuidv7 } from '$lib/server/db/ids';
import { shares, type ShareRow } from '$lib/server/db/schema';
import { assertShareable, getReport } from '$lib/server/documents/reports';
import { AppError } from '$lib/server/problem';
import { generateShareToken, hashShareToken } from './tokens';

/** Share-link modes (FR20): restricted = recipient list (3.4), open = anyone with the link. */
export type ShareMode = 'restricted' | 'open';

/** A share's lifecycle state, derived from `revokedAt`/`expiresAt` against now. */
export type ShareStatus = 'active' | 'expired' | 'revoked';

/** Management-view projection: never carries the raw token (it is gone after creation). */
export interface ShareSummary {
	id: string;
	mode: ShareMode;
	expiresAt: Date | null;
	createdAt: Date;
	revokedAt: Date | null;
	status: ShareStatus;
}

/** A resolved share (by raw token) plus its current status, for the reader gate. */
export interface ResolvedShare {
	id: string;
	reportId: string;
	mode: ShareMode;
	expiresAt: Date | null;
	createdAt: Date;
	revokedAt: Date | null;
	status: ShareStatus;
}

/** The one-time result of creating a share: the raw token (URL only) + the new row's summary. */
export interface CreatedShare {
	token: string;
	share: ShareSummary;
}

export interface CreateShareInput {
	mode?: ShareMode;
	/** Absolute expiry instant (FR21); omitted/null means no time bound. */
	expiresAt?: Date | null;
}

/**
 * A share's status against `now`: revocation wins over expiry (a revoked share
 * is revoked even past its expiry), then an elapsed `expiresAt` is expired, else
 * active. A null `expiresAt` never expires (FR21 "optional expiry").
 */
export function shareStatus(
	share: Pick<ShareRow, 'expiresAt' | 'revokedAt'>,
	now: Date = new Date()
): ShareStatus {
	if (share.revokedAt !== null) return 'revoked';
	if (share.expiresAt !== null && share.expiresAt.getTime() <= now.getTime()) return 'expired';
	return 'active';
}

/** True when the share's `expiresAt` has elapsed against `now`; a null expiry never elapses. */
export function isExpired(share: Pick<ShareRow, 'expiresAt'>, now: Date = new Date()): boolean {
	return share.expiresAt !== null && share.expiresAt.getTime() <= now.getTime();
}

function toSummary(row: ShareRow): ShareSummary {
	return {
		id: row.id,
		mode: row.mode as ShareMode,
		expiresAt: row.expiresAt ?? null,
		createdAt: row.createdAt,
		revokedAt: row.revokedAt ?? null,
		status: shareStatus(row)
	};
}

function expiryInPast(): AppError {
	return new AppError({
		status: 422,
		title: 'Expiry is in the past',
		type: '/problems/share-expiry-past',
		detail: 'Choose an expiry date in the future, or leave it blank for no time bound.'
	});
}

/**
 * Creates a share for a published report. Refuses a draft via `assertShareable`
 * (409 `/problems/report-not-published`) BEFORE minting a token, so no token is
 * ever generated for a non-shareable report. Mints a 256-bit token, stores only
 * its hash plus the metadata, and returns the raw token once (URL only).
 */
export async function createShare(
	reportId: string,
	input: CreateShareInput = {}
): Promise<CreatedShare> {
	const report = await getReport(reportId);
	assertShareable(report);

	const expiresAt = input.expiresAt ?? null;
	if (expiresAt !== null && expiresAt.getTime() <= Date.now()) throw expiryInPast();

	const token = generateShareToken();
	const now = new Date();
	const row: ShareRow = {
		id: uuidv7(),
		reportId: report.id,
		tokenHash: hashShareToken(token),
		mode: input.mode ?? 'restricted',
		expiresAt,
		createdAt: now,
		revokedAt: null
	};
	await getDb().insert(shares).values(row);

	return { token, share: toSummary(row) };
}

/**
 * Lists a report's shares, newest first, for the management UI. Returns id,
 * mode, expiry, creation, revocation, and the derived status - never the raw
 * token (it does not exist after creation).
 */
export async function listShares(reportId: string): Promise<ShareSummary[]> {
	const rows = await getDb()
		.select()
		.from(shares)
		.where(eq(shares.reportId, reportId))
		.orderBy(desc(shares.createdAt));
	return rows.map(toSummary);
}

/**
 * Resolves a raw share token to its share, hashing the token and matching on the
 * unique `token_hash` index (never a raw-token comparison). Returns null when no
 * share matches. The returned `status` (active/expired/revoked) lets the reader
 * gate (3.3) and the neutral page (3.5) decide; this story only needs the
 * resolution and the status, not route-level enforcement.
 */
export async function getShareByToken(rawToken: string): Promise<ResolvedShare | null> {
	const rows = await getDb()
		.select()
		.from(shares)
		.where(eq(shares.tokenHash, hashShareToken(rawToken)))
		.limit(1);
	const row = rows[0];
	if (!row) return null;
	return {
		id: row.id,
		reportId: row.reportId,
		mode: row.mode as ShareMode,
		expiresAt: row.expiresAt ?? null,
		createdAt: row.createdAt,
		revokedAt: row.revokedAt ?? null,
		status: shareStatus(row)
	};
}

/**
 * Switches a share between restricted and open mode (FR19, story 3.4). The
 * recipient allow-list is left untouched - switching to open simply ignores it,
 * switching back to restricted re-applies the same list - so the author can
 * toggle without losing the list. Returns the number of rows updated (0 when the
 * share id is unknown), the caller maps a miss to a 404.
 */
export async function setShareMode(shareId: string, mode: ShareMode): Promise<number> {
	const updated = await getDb()
		.update(shares)
		.set({ mode })
		.where(eq(shares.id, shareId))
		.returning({ id: shares.id });
	return updated.length;
}

/**
 * Revokes a share (FR20): one-click, immediate, irreversible. Sets `revoked_at`
 * to now so the reader gate's per-load liveness check (`status !== 'active'`)
 * serves the neutral page on the very next request - no cache window given the
 * reader responses are `no-store`. Then sweeps every already-verified reader
 * session bound to the share via `destroyReaderSessionsForShare`, so a reader
 * mid-session is cut off immediately (defense in depth: the gate's liveness
 * re-check alone already stops serving, but dropping the session rows frees them
 * and removes any lingering credential).
 *
 * Idempotent: revoking an already-revoked share is a NO-OP, not an error. The
 * `WHERE revoked_at IS NULL` guard means a second revoke updates zero rows and
 * preserves the original revocation instant; the session sweep is run regardless
 * (it is itself idempotent - a no-op when no sessions remain). A genuinely
 * unknown share id matches nothing and returns silently (the caller has already
 * resolved the share from its own report's list, author-realm under the guard).
 */
export async function revokeShare(shareId: string): Promise<void> {
	await getDb()
		.update(shares)
		.set({ revokedAt: new Date() })
		.where(and(eq(shares.id, shareId), isNull(shares.revokedAt)));
	await destroyReaderSessionsForShare(shareId);
}

/**
 * Builds the public reader URL for a raw token. The token is the only place the
 * raw value lives; this is the single point that composes it into `/r/[token]`
 * (the reader render route story 3.3 gates). `origin` is the request origin so
 * the link is absolute and copy-pasteable.
 */
export function shareUrl(origin: string, token: string): string {
	return `${origin}/r/${token}`;
}
