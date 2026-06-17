import { sql } from 'drizzle-orm';
import {
	check,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	type AnyPgColumn
} from 'drizzle-orm/pg-core';
import type { DocumentV1 } from '$lib/schema';

// Author-realm sessions. Originally planned as a shared two-realm table (D4), but
// reader sessions ended up PHYSICALLY SEPARATE in `reader_sessions` (NFR12, each
// realm keeps its own NOT NULL/FK shape - see sessions.ts), so this table only
// ever stores `realm = 'author'`. The `realm` column and its CHECK keep both
// values as a forward-schema artifact (the original D4 design), but no row here is
// ever written with `realm = 'reader'`.
//
// `author_id` (Epic 8, story 8.3) binds an author-realm session to the author it
// authenticated, so the workspace resolves the REAL logged-in author (tenancy,
// 8.2) instead of the implicit one. Nullable because a single-mode author session
// carries no per-author identity (one implicit author owns everything, the column
// stays null and `resolveAuthorScope` falls back to the implicit author) - only a
// multi-mode magic-link session populates it. ON DELETE CASCADE: an author row
// removed takes its live sessions with it (a session with no author is dead).
export const sessions = pgTable(
	'sessions',
	{
		id: uuid('id').primaryKey(),
		realm: text('realm').notNull(),
		tokenHash: text('token_hash').notNull(),
		authorId: uuid('author_id').references(() => authors.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		metadata: jsonb('metadata').$type<Record<string, unknown>>()
	},
	(table) => [
		uniqueIndex('sessions_token_hash_idx').on(table.tokenHash),
		check('sessions_realm_check', sql`${table.realm} in ('author', 'reader')`)
	]
);

export type SessionRow = typeof sessions.$inferSelect;

// An author identity (Epic 8, story 8.2): the owner of reports, data sets, and
// API tokens, and (story 8.3) the subject of an author-realm session. Identity =
// email. In SINGLE mode there is exactly ONE implicit author (the password
// author) owning everything, seeded at boot under a sentinel email; in MULTI
// mode each magic-link author is a row, minted on first sign-in (8.3).
//
// `email` is normalized (lowercased/trimmed) BEFORE it reaches this table - the
// same boundary normalization the reader identity path applies - so the unique
// index is a canonical-email identity key (`Foo@X.com` and `foo@x.com` are one
// author). The single-mode implicit author uses a reserved sentinel local part
// that no real submitted email can collide with (see authors/identity.ts).
export const authors = pgTable(
	'authors',
	{
		id: uuid('id').primaryKey(),
		email: text('email').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [uniqueIndex('authors_email_idx').on(table.email)]
);

export type AuthorRow = typeof authors.$inferSelect;

// A report series (Epic 9, story 9.1): the lineage that groups the consecutive
// editions of one recurring report. A series is an EXPLICIT edge, not a guess
// from titles or timestamps - it is created when an author starts the next issue
// (duplicateReport, FR10) and inherited by every duplicate down the chain. The
// row carries almost nothing on its own: the series is identified by its id, the
// issues point back at it via `reports.series_id`, and the order among them is
// the predecessor chain on `reports.predecessor_id` (NOT published_at).
//
// Owner-scoped (story 9.1): a series NEVER spans authors - it belongs to exactly
// one author and only that author's reports may join it. Unlike the report-side
// `owner_id` columns (added nullable then backfilled), `report_series` is born
// with the model: every row is APP-INSERTED with an owner (the boot backfill or
// `createSeries`), so `owner_id` is NOT NULL - a series always has an owner, never
// a transient null. ON DELETE RESTRICT: an author owning series is not deletable
// out from under them.
export const reportSeries = pgTable(
	'report_series',
	{
		id: uuid('id').primaryKey(),
		ownerId: uuid('owner_id')
			.notNull()
			.references(() => authors.id, { onDelete: 'restrict' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [index('report_series_owner_id_idx').on(table.ownerId)]
);

export type ReportSeriesRow = typeof reportSeries.$inferSelect;

// D2: the report document lives in a JSONB column; the relational columns
// around it carry only what lists and lifecycle checks need. `schema_version`
// is denormalized from the document so version queries never parse JSONB.
//
// Publish snapshot (story 1.7): `document` is always the authoring draft. At
// publish time it is frozen into `published_document` with `published_at`, so
// the draft can keep evolving while readers keep seeing the version that was
// published. `published_document` is null until the report is first published.
export const reports = pgTable(
	'reports',
	{
		id: uuid('id').primaryKey(),
		title: text('title').notNull(),
		status: text('status').notNull().default('draft'),
		schemaVersion: integer('schema_version').notNull(),
		document: jsonb('document').$type<DocumentV1>().notNull(),
		publishedDocument: jsonb('published_document').$type<DocumentV1>(),
		publishedAt: timestamp('published_at', { withTimezone: true }),
		// Per-report ownership (Epic 8, story 8.2). One report = one author. Added
		// nullable because the migration runs against pre-existing rows; the boot
		// inheritance step (authors/inheritance.ts) backfills every null to the
		// single implicit author (single mode) or INITIAL_OWNER_EMAIL (first multi
		// boot), so a live row always carries an owner. ON DELETE RESTRICT: an
		// author owning reports cannot be deleted out from under them (no orphans).
		ownerId: uuid('owner_id').references(() => authors.id, { onDelete: 'restrict' }),
		// Series lineage (Epic 9, story 9.1). `series_id` is the lineage this issue
		// belongs to; `predecessor_id` is the issue it was duplicated from (null for
		// the first issue of a series). Added nullable because the migration runs
		// against pre-existing rows; the boot series backfill (authors/inheritance.ts)
		// gives every owner-less-of-series report a fresh single-issue series and a
		// null predecessor, so a live row always carries a series. The series is
		// owner-consistent by construction (a series never spans authors, story 9.1).
		// `predecessor_id` is a SELF-reference to the prior issue; the chain is the
		// authoritative order. ON DELETE RESTRICT on both so a referenced series or
		// predecessor is never deleted out from under the issues that point at it.
		seriesId: uuid('series_id').references(() => reportSeries.id, { onDelete: 'restrict' }),
		predecessorId: uuid('predecessor_id').references((): AnyPgColumn => reports.id, {
			onDelete: 'restrict'
		}),
		// An optional author-set display label for an issue ("2026-W24", "June board
		// pack"). COSMETIC only (story 9.1): it never affects ordering or diffing - the
		// predecessor chain is the order, published_at is a label. Null until set.
		issueLabel: text('issue_label'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('reports_owner_id_idx').on(table.ownerId),
		index('reports_series_id_idx').on(table.seriesId),
		index('reports_predecessor_id_idx').on(table.predecessorId),
		check('reports_status_check', sql`${table.status} in ('draft', 'published')`)
	]
);

export type ReportRow = typeof reports.$inferSelect;

// A skeleton (FR9/FR11) is a reusable report structure: the same JSONB `DocumentV1`
// the reports table stores, with placeholder bindings instead of data. The
// document title doubles as the library name. `schema_version` is denormalized
// from the document, mirroring the reports table, so version queries never parse
// JSONB.
//
// Per-author ownership (Epic 8, story 8.2). Added nullable and backfilled at boot
// like reports/data sets/tokens (the inheritance step assigns every pre-existing
// row to the single implicit author / the INITIAL_OWNER_EMAIL author). ON DELETE
// RESTRICT: an author owning skeletons is not deletable out from under them.
//
// The unique index is `(owner_id, name)`, NOT a global `name`: two authors may use
// the same skeleton name, and the 409 `skeleton-name-taken` only fires WITHIN one
// author's library - so a name is neither a cross-author squat nor an existence
// oracle. In single mode (one implicit author) this is equivalent to the prior
// global-name index.
export const skeletons = pgTable(
	'skeletons',
	{
		id: uuid('id').primaryKey(),
		name: text('name').notNull(),
		schemaVersion: integer('schema_version').notNull(),
		document: jsonb('document').$type<DocumentV1>().notNull(),
		ownerId: uuid('owner_id').references(() => authors.id, { onDelete: 'restrict' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('skeletons_owner_id_name_idx').on(table.ownerId, table.name),
		index('skeletons_owner_id_idx').on(table.ownerId)
	]
);

export type SkeletonRow = typeof skeletons.$inferSelect;

/** One inspected column of an uploaded data set: name + inferred type. */
export interface DataSetField {
	name: string;
	type: 'string' | 'number' | 'date' | 'boolean';
}

// An uploaded data file (FR12): the bytes live on the uploads volume, the
// metadata row lives here (D2/D12). `fields` is the inspected column list
// (name + inferred type) the binding UI and resolver read without re-parsing
// the file. `report_id` is the report the upload happened in (nullable: a data
// set can outlive or precede a report). `injected_at` is the upload time;
// `data_as_of` is the FR16 "as of" timestamp (carried now, rendered in Epic 6).
// `storage_path` is the uploads-volume path of the stored file (a UUIDv7 name,
// never the user filename, to defeat path traversal).
export const dataSets = pgTable(
	'data_sets',
	{
		id: uuid('id').primaryKey(),
		reportId: uuid('report_id').references(() => reports.id, { onDelete: 'set null' }),
		filename: text('filename').notNull(),
		sourceFormat: text('source_format').notNull(),
		fields: jsonb('fields').$type<DataSetField[]>().notNull(),
		injectedAt: timestamp('injected_at', { withTimezone: true }).notNull().defaultNow(),
		dataAsOf: timestamp('data_as_of', { withTimezone: true }),
		storagePath: text('storage_path').notNull(),
		// Per-author ownership (Epic 8, story 8.2). A DIRECT owner column, not a
		// scope-through-report: `report_id` is NULLABLE (a data set can precede or
		// outlive a report), so a NULL-report data set has no report to inherit an
		// owner from - it must carry its own. Added nullable, backfilled at boot
		// like reports. ON DELETE RESTRICT: an author with data sets is not deletable.
		ownerId: uuid('owner_id').references(() => authors.id, { onDelete: 'restrict' })
	},
	(table) => [
		index('data_sets_report_id_idx').on(table.reportId),
		index('data_sets_owner_id_idx').on(table.ownerId),
		check('data_sets_format_check', sql`${table.sourceFormat} in ('csv', 'json', 'xlsx')`)
	]
);

export type DataSetRow = typeof dataSets.$inferSelect;

// A share link (FR17/FR21/NFR6) points a reader at a published report. The token
// is held two ways. `token_hash` is the SHA-256 hash-at-rest (D5, same as the
// sessions token) and is uniquely indexed: the reader gate (story 3.3) resolves
// a presented token by hashing the URL token and looking it up here - that
// lookup is one-way and never reverses a leaked hash into a working link.
// `token_cipher` is the SAME token reversibly encrypted at rest (AES-256-GCM,
// key derived from SESSION_SECRET via HKDF, see token-cipher.ts), so the
// authenticated owner can re-display and re-send an existing link from the
// management view. A DB-only leak (the dump without SESSION_SECRET) still yields
// no usable link: the hash is irreversible and the cipher is undecryptable
// without the app key. `token_cipher` is NULLABLE - rows created before this
// feature have no recoverable token (the link is unrecoverable, surfaced in the
// UI as "revoke and recreate").
//
// `report_id` is ON DELETE CASCADE (contrast `data_sets`' SET NULL): a share is
// meaningless without its report - it serves that report's published snapshot
// and nothing else, so when the report is deleted its shares must vanish with
// it (a dangling share would resolve to no report). A data set, by contrast,
// can legitimately outlive or precede a report, hence SET NULL there.
//
// Forward-schema columns created now, exercised later (same discipline as the
// sessions `realm` column): `mode` ('restricted'|'open', default 'restricted' =
// the safe default) is driven in story 3.4; `revoked_at` (null = active) is set
// in story 3.5. Defining them now keeps the schema stable so 3.3/3.4/3.5 do not
// re-migrate. `expires_at` is the author-chosen absolute expiry (null = no time
// bound, FR21); enforcement on the reader side is story 3.5.
export const shares = pgTable(
	'shares',
	{
		id: uuid('id').primaryKey(),
		reportId: uuid('report_id')
			.notNull()
			.references(() => reports.id, { onDelete: 'cascade' }),
		tokenHash: text('token_hash').notNull(),
		tokenCipher: text('token_cipher'),
		mode: text('mode').notNull().default('restricted'),
		expiresAt: timestamp('expires_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		revokedAt: timestamp('revoked_at', { withTimezone: true })
	},
	(table) => [
		uniqueIndex('shares_token_hash_idx').on(table.tokenHash),
		index('shares_report_id_idx').on(table.reportId),
		check('shares_mode_check', sql`${table.mode} in ('restricted', 'open')`)
	]
);

export type ShareRow = typeof shares.$inferSelect;

// A restricted share's allow-list (FR19, story 3.4). One row per authorized
// email per share. In `restricted` mode the verification gate refuses any email
// absent from this list - but BEHIND the neutral confirmation, so an off-list
// email is byte-indistinguishable from an on-list one (NFR9 enumeration-safety).
// In `open` mode this table is ignored: any verified email may read, so an open
// share simply has no recipient rows.
//
// `email` is normalized (lowercased/trimmed) BEFORE it reaches this table - the
// same boundary normalization the reader identity/verification path applies - so
// the unique (share, email) index is a canonical-email membership key and
// `Foo@X.com` and `foo@x.com` are one entry. CASCADE on the share: a deleted
// share's allow-list goes with it.
export const shareRecipients = pgTable(
	'share_recipients',
	{
		id: uuid('id').primaryKey(),
		shareId: uuid('share_id')
			.notNull()
			.references(() => shares.id, { onDelete: 'cascade' }),
		email: text('email').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [uniqueIndex('share_recipients_share_id_email_idx').on(table.shareId, table.email)]
);

export type ShareRecipientRow = typeof shareRecipients.$inferSelect;

// A verified reader (FR22). ONE global row per email (the backlog uniqueness
// decision): the same person verifying against several shares is one identity,
// and the per-access audit lives in `access_records` (many per identity). The
// email is normalized (lowercased/trimmed) BEFORE it reaches this table, so the
// unique index is the canonical-email identity key. `last_verified_at` moves
// forward on each successful verification; `created_at` is the first sighting.
export const readerIdentities = pgTable(
	'reader_identities',
	{
		id: uuid('id').primaryKey(),
		email: text('email').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [uniqueIndex('reader_identities_email_idx').on(table.email)]
);

export type ReaderIdentityRow = typeof readerIdentities.$inferSelect;

// One audit row per verified access (FR22): which identity reached which report,
// through which share, when. Many rows per identity (the identity is global, the
// access is per-share-per-verification). FKs CASCADE: an access record is
// meaningless once its share or report is gone, and once the identity is purged
// (FR24 retention, a later Epic) its audit trail goes with it.
export const accessRecords = pgTable(
	'access_records',
	{
		id: uuid('id').primaryKey(),
		readerIdentityId: uuid('reader_identity_id')
			.notNull()
			.references(() => readerIdentities.id, { onDelete: 'cascade' }),
		shareId: uuid('share_id')
			.notNull()
			.references(() => shares.id, { onDelete: 'cascade' }),
		reportId: uuid('report_id')
			.notNull()
			.references(() => reports.id, { onDelete: 'cascade' }),
		accessedAt: timestamp('accessed_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('access_records_reader_identity_id_idx').on(table.readerIdentityId),
		index('access_records_share_id_idx').on(table.shareId),
		index('access_records_report_id_idx').on(table.reportId),
		// The audit query (`listAccessRecords`) filters by report and orders by
		// accessed_at DESC under a keyset cursor (story 6.3 + the cursor pagination).
		// The (report_id, accessed_at) composite keys the report-scoped ordered scan
		// so a report's log pages without re-sorting; the (accessed_at, id) composite
		// keys the keyset order + tiebreak for the unfiltered (owner-only) page.
		index('access_records_report_id_accessed_at_idx').on(table.reportId, table.accessedAt),
		index('access_records_accessed_at_id_idx').on(table.accessedAt, table.id)
	]
);

export type AccessRecordRow = typeof accessRecords.$inferSelect;

// In-flight reader verification (FR18). A single-use, 15-minute-TTL token bound
// to BOTH the share and the requesting email: the clicked link binds back to the
// share it was requested for AND the address that requested it (forwarding the
// raw link does not verify a different address - load-bearing for 3.4 restricted
// mode). The raw token lives only in the emailed URL; the table stores its hash
// (shared at-rest helper). `consumed_at` flips on the first valid click so a
// second click is rejected (single-use). CASCADE on the share: a token for a
// deleted share is dead.
export const verificationTokens = pgTable(
	'verification_tokens',
	{
		id: uuid('id').primaryKey(),
		tokenHash: text('token_hash').notNull(),
		shareId: uuid('share_id')
			.notNull()
			.references(() => shares.id, { onDelete: 'cascade' }),
		email: text('email').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		consumedAt: timestamp('consumed_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('verification_tokens_token_hash_idx').on(table.tokenHash),
		index('verification_tokens_share_id_idx').on(table.shareId),
		// The dedup read (`hasLiveVerification`) filters on (share_id, email); the
		// composite index keys that lookup instead of scanning a share's tokens.
		index('verification_tokens_share_id_email_idx').on(table.shareId, table.email)
	]
);

export type VerificationTokenRow = typeof verificationTokens.$inferSelect;

// Reader-realm sessions (NFR12), physically separate from the author `sessions`
// table so each keeps its own NOT NULL/FK shape and lifecycle (see sessions.ts
// for the realm rationale). Per-share scope: a session is bound to ONE share +
// report + reader identity - a session for share A authorizes nothing for share
// B. Token hashed at rest (shared helper). All FKs CASCADE: a session is dead
// once its share, report, or identity is gone. `expires_at` is NULLABLE: null =
// the session has no time bound and never ages out on its own (the default;
// access is governed entirely by the share's own expiry + revocation, which the
// reader gate re-checks on every load). A non-null value is the optional
// operator override (READER_SESSION_TTL set to N days) forcing sessions to age
// out.
export const readerSessions = pgTable(
	'reader_sessions',
	{
		id: uuid('id').primaryKey(),
		tokenHash: text('token_hash').notNull(),
		shareId: uuid('share_id')
			.notNull()
			.references(() => shares.id, { onDelete: 'cascade' }),
		reportId: uuid('report_id')
			.notNull()
			.references(() => reports.id, { onDelete: 'cascade' }),
		readerIdentityId: uuid('reader_identity_id')
			.notNull()
			.references(() => readerIdentities.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		expiresAt: timestamp('expires_at', { withTimezone: true })
	},
	(table) => [
		uniqueIndex('reader_sessions_token_hash_idx').on(table.tokenHash),
		index('reader_sessions_share_id_idx').on(table.shareId)
	]
);

export type ReaderSessionRow = typeof readerSessions.$inferSelect;

// Personal access tokens (D10): the THIRD auth surface (programmatic, PAT
// bearer) alongside the author and reader cookie realms. A PAT authorizes the
// `/api/v1` surface for scripts and agents; it never opens a cookie session, and
// a cookie never authorizes the API (strict realm separation, NFR12 extended to
// the API).
//
// The raw token is a high-entropy `acta_pat_<base64url>` value handed to the
// author ONCE at creation; the table stores only its SHA-256 hash (shared
// at-rest helper, same as sessions/shares) - a database leak exposes no usable
// token. `token_hash` is uniquely indexed: `authenticateApiToken` hashes the
// presented bearer and matches on the digest. `display_fragment` is a NON-secret
// snippet (the last 4 chars of the raw token) shown in the management list so two
// tokens are distinguishable without re-revealing either (the prefix is greppable
// and not secret; only the body is).
//
// Author-scoped (Epic 8, story 8.2): `owner_id` ties a PAT to the author who
// minted it. A PAT authorizes ONLY its owner's resources - it never crosses
// authors (the API identity carries the owner, resolved in `authenticateApiToken`).
// Added nullable and backfilled at boot like reports/data sets (the inheritance
// step assigns every pre-existing token to the single implicit author / the
// INITIAL_OWNER_EMAIL author). ON DELETE RESTRICT: an author with tokens is not
// deletable. `name` is the author-chosen label. `last_used_at` (null until first
// use) is stamped best-effort on each successful authentication; `revoked_at`
// (null = active) is set on revoke and the row is NEVER deleted (an audit trail).
// V1 is revoke-only, no expiry (backlog Epic 4 decision).
export const apiTokens = pgTable(
	'api_tokens',
	{
		id: uuid('id').primaryKey(),
		name: text('name').notNull(),
		tokenHash: text('token_hash').notNull(),
		displayFragment: text('display_fragment').notNull(),
		ownerId: uuid('owner_id').references(() => authors.id, { onDelete: 'restrict' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
		revokedAt: timestamp('revoked_at', { withTimezone: true })
	},
	(table) => [
		uniqueIndex('api_tokens_token_hash_idx').on(table.tokenHash),
		index('api_tokens_owner_id_idx').on(table.ownerId),
		index('api_tokens_revoked_at_idx').on(table.revokedAt)
	]
);

export type ApiTokenRow = typeof apiTokens.$inferSelect;

// In-flight AUTHOR magic-link verification (Epic 8, story 8.3). The author-realm
// parallel of `verification_tokens`: a single-use, 15-minute-TTL token bound to
// the requesting EMAIL alone (no share - an author signs in to the whole
// workspace, not to one report). The two tables are kept PHYSICALLY SEPARATE so
// the realms never blur (NFR12): a reader verification token (share-bound) can
// never open an author session and an author token can never verify a reader
// share - they live in different tables consumed by different functions, and an
// author token has no share id to resolve.
//
// The raw token lives only in the emailed URL; the table stores its SHA-256 hash
// (shared at-rest helper). `consumed_at` flips on the first valid click so a
// second click is rejected (single-use). `email` is normalized (lowercased/
// trimmed) BEFORE it reaches this table, the same boundary normalization the
// reader path applies, so the dedup lookup keys on a canonical address. No FK:
// the author row does not exist yet on a FIRST sign-in (it is minted on consume),
// so the token binds the email, not an author id.
export const authorVerificationTokens = pgTable(
	'author_verification_tokens',
	{
		id: uuid('id').primaryKey(),
		tokenHash: text('token_hash').notNull(),
		email: text('email').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		consumedAt: timestamp('consumed_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('author_verification_tokens_token_hash_idx').on(table.tokenHash),
		// The dedup read (`hasLiveAuthorVerification`) filters on email; this index
		// keys that lookup instead of scanning the table.
		index('author_verification_tokens_email_idx').on(table.email)
	]
);

export type AuthorVerificationTokenRow = typeof authorVerificationTokens.$inferSelect;
