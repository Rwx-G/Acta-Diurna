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
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { ownerFilter, type AuthorScope } from '$lib/server/authors';
import { destroyReaderSessionsForShare } from '$lib/server/auth/sessions';
import { getDb } from '$lib/server/db/client';
import { UUID_PATTERN, uuidv7 } from '$lib/server/db/ids';
import { reports, shares, type ShareRow } from '$lib/server/db/schema';
import { assertShareable, getReport } from '$lib/server/documents/reports';
import { isMultiAuthor } from '$lib/server/mode';
import { AppError } from '$lib/server/problem';
import { generateShareToken, hashShareToken } from './tokens';

/**
 * Share-link modes (FR20): restricted = recipient list (3.4), open = anyone with
 * the link.
 *
 * The mode is meaningful only in MULTI mode, where the reader verifies by email
 * (3.3) and the restricted list gates which emails may. In SINGLE mode there is
 * no email and no verification, so a share is a bare consultation token: it is
 * always stored as `open` (the only mode single mode mints, see `createShare`),
 * and the reader gate serves an `open` share directly. A `restricted` share is
 * therefore only ever a MULTI-era artifact; if such a share is reached while the
 * instance runs SINGLE mode (SMTP was removed), the gate treats it as CLOSED
 * rather than silently opening it to anyone with the link - the transition never
 * escalates access (story 8.4 transition rule, see `servesConsultation`).
 */
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

/**
 * Whether a LIVE share should be served as a consultation token (story 8.4):
 * read access granted DIRECTLY by holding the link, with no email verification.
 * This is the SINGLE-mode reader path, and the caller must already have confirmed
 * the share is `active` (the consultation grant never resurrects a revoked or
 * expired share - that is still the neutral 404).
 *
 * The rule honors the CURRENT operating mode, never the mode the share was minted
 * in, so a stale share can never escalate access across a mode change:
 *
 *   - MULTI mode: always false. The verified magic-link flow (Epic 3) runs for
 *     every share, including a SINGLE-era consultation share - which is `open`,
 *     so it becomes open-with-verification (a STRICTER gate, never an escalation).
 *   - SINGLE mode + `open` share: true. The consultation tokens single mode mints
 *     are `open`, and so are MULTI-era open shares; both serve directly.
 *   - SINGLE mode + `restricted` share: FALSE. A restricted share is a MULTI-era
 *     artifact whose recipient list cannot be enforced without email. Serving it
 *     directly would broaden a recipient-gated link to anyone holding it, so it is
 *     treated as CLOSED (the gate serves the neutral 404) until the instance runs
 *     multi mode again. Closed-not-opened is the safe transition.
 */
export function servesConsultation(share: Pick<ResolvedShare, 'mode'>): boolean {
	if (isMultiAuthor()) return false;
	return share.mode === 'open';
}

/** 409 refusing a restricted-mode / recipient operation while the instance runs single mode. */
function restrictedModeUnavailable(): AppError {
	return new AppError({
		status: 409,
		title: 'Restricted sharing is unavailable',
		type: '/problems/restricted-sharing-unavailable',
		detail:
			'This instance has no SMTP configured, so it cannot verify recipients. Shares are consultation links anyone with the link can open. Configure SMTP to enable restricted, per-recipient sharing.'
	});
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
 *
 * Mode by operating mode (story 8.4): in MULTI mode the author chooses
 * restricted/open (default `restricted`). In SINGLE mode there is no email and no
 * recipient verification, so the share is always a consultation token, stored as
 * `open`; an explicit `restricted` request is REFUSED (409) rather than silently
 * downgraded, so the caller is never misled into thinking a recipient list took.
 */
export async function createShare(
	reportId: string,
	scope: AuthorScope,
	input: CreateShareInput = {}
): Promise<CreatedShare> {
	// The scoped read is the tenancy gate: a report the author does not own is a
	// 404 here (no existence oracle), so a share is only ever minted on an owned
	// report, and the share inherits that report's ownership transitively.
	const report = await getReport(reportId, scope);
	assertShareable(report);

	const expiresAt = input.expiresAt ?? null;
	if (expiresAt !== null && expiresAt.getTime() <= Date.now()) throw expiryInPast();

	// Single mode mints consultation tokens only: force `open` and refuse an
	// explicit restricted request (no email, so no recipient list to enforce).
	const multi = isMultiAuthor();
	if (!multi && input.mode === 'restricted') throw restrictedModeUnavailable();
	const mode: ShareMode = multi ? (input.mode ?? 'restricted') : 'open';

	const token = generateShareToken();
	const now = new Date();
	const row: ShareRow = {
		id: uuidv7(),
		reportId: report.id,
		tokenHash: hashShareToken(token),
		mode,
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
export async function listShares(reportId: string, scope: AuthorScope): Promise<ShareSummary[]> {
	// Shares scope through their report (a share has a non-null report_id, so it
	// inherits the report's owner). The scoped read raises the same 404 when the
	// report is unknown or owned by another author, so this never lists a foreign
	// report's shares; single mode is a no-op so the list is unchanged.
	await getReport(reportId, scope);
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
 * Whether `scope` owns the share - i.e. owns the report the share belongs to
 * (shares scope through their report, story 8.2). Resolves the share's report id
 * and runs the SCOPED `getReport`: an owned report resolves, a foreign or
 * unknown one is the 404 the scoped read raises. Returns false (the caller's
 * silent no-op / 404) for a malformed or unknown share id, so a share-management
 * action on another author's share is indistinguishable from one on a missing
 * share - no existence oracle. In single mode the scoped read is a no-op, so this
 * is true for any existing share, preserving today's behavior.
 */
export async function ownsShare(shareId: string, scope: AuthorScope): Promise<boolean> {
	if (!UUID_PATTERN.test(shareId)) return false;
	// One guarded JOIN replaces the prior two round-trips (resolve report id, then a
	// scoped getReport): shares JOIN reports ON report_id, filtered on the share id
	// AND the owner predicate (E4). In single mode `ownerFilter` is undefined and the
	// WHERE is the bare share-id match through the join (any existing share is owned),
	// byte-identical in result to the prior single-mode behavior. In multi mode the
	// owner predicate ANDs in, so a foreign share misses and this is false - the same
	// no-existence-oracle result the scoped getReport raised.
	const owner = ownerFilter(scope, reports.ownerId);
	const where = owner ? and(eq(shares.id, shareId), owner) : eq(shares.id, shareId);
	const rows = await getDb()
		.select({ id: shares.id })
		.from(shares)
		.innerJoin(reports, eq(shares.reportId, reports.id))
		.where(where)
		.limit(1);
	return rows.length > 0;
}

/**
 * Switches a share between restricted and open mode (FR19, story 3.4). The
 * recipient allow-list is left untouched - switching to open simply ignores it,
 * switching back to restricted re-applies the same list - so the author can
 * toggle without losing the list. Returns the number of rows updated (0 when the
 * share id is unknown OR owned by another author - the caller maps a miss to a
 * 404, the same neutral result either way).
 *
 * Single mode (story 8.4): switching a share to `restricted` is REFUSED (409) -
 * there is no email to verify recipients against, so the restricted concept does
 * not exist. Switching to `open` is a no-op there (single-mode shares are already
 * open consultation tokens) but is allowed so the UI never needs a special case.
 */
export async function setShareMode(
	shareId: string,
	mode: ShareMode,
	scope: AuthorScope
): Promise<number> {
	if (!isMultiAuthor() && mode === 'restricted') throw restrictedModeUnavailable();
	if (!(await ownsShare(shareId, scope))) return 0;
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
 *
 * Tenancy (story 8.2): a share the author does not own (foreign report) is a
 * silent no-op too - `ownsShare` gates the revoke and the session sweep, so an
 * author can never revoke or disrupt another author's share. Single mode: any
 * existing share is owned by the one implicit author, so behavior is unchanged.
 */
export async function revokeShare(shareId: string, scope: AuthorScope): Promise<void> {
	// Ownership gates BOTH the revoke and the session sweep (story 8.2): a foreign
	// share must be a full no-op, never a sweep that disrupts another author's
	// readers. The gate is now ONE JOIN query (E4); it stays the gate so the sweep
	// runs ONLY for an owned share - the same per-load tenancy guarantee as before.
	if (!(await ownsShare(shareId, scope))) return;
	// The guarded UPDATE is owner-scoped too (defense in depth, E4): `report_id IN
	// (owned reports)` ANDs in only in multi mode. Single mode omits it (ownerFilter
	// undefined), keeping the UPDATE WHERE byte-identical to the prior `and(eq(id),
	// isNull(revoked_at))`. The isNull guard preserves idempotency: a second revoke
	// matches zero rows and keeps the original instant.
	const owner = ownerFilter(scope, reports.ownerId);
	const guard = owner
		? and(
				eq(shares.id, shareId),
				isNull(shares.revokedAt),
				inArray(shares.reportId, getDb().select({ id: reports.id }).from(reports).where(owner))
			)
		: and(eq(shares.id, shareId), isNull(shares.revokedAt));
	await getDb().update(shares).set({ revokedAt: new Date() }).where(guard);
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
