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
	uuid
} from 'drizzle-orm/pg-core';
import type { DocumentV1 } from '$lib/schema';

// Both realms (D4) share this table; only the author realm is implemented in
// 1.4, the reader realm (Epic 3) reuses the same shape with realm='reader'.
export const sessions = pgTable(
	'sessions',
	{
		id: uuid('id').primaryKey(),
		realm: text('realm').notNull(),
		tokenHash: text('token_hash').notNull(),
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
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [check('reports_status_check', sql`${table.status} in ('draft', 'published')`)]
);

export type ReportRow = typeof reports.$inferSelect;

// A skeleton (FR9/FR11) is a reusable report structure: the same JSONB `DocumentV1`
// the reports table stores, with placeholder bindings instead of data. `name` is
// unique so the library lists distinct templates (the document title doubles as
// the name; a duplicate is a 409). `schema_version` is denormalized from the
// document, mirroring the reports table, so version queries never parse JSONB.
export const skeletons = pgTable(
	'skeletons',
	{
		id: uuid('id').primaryKey(),
		name: text('name').notNull(),
		schemaVersion: integer('schema_version').notNull(),
		document: jsonb('document').$type<DocumentV1>().notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [uniqueIndex('skeletons_name_idx').on(table.name)]
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
		storagePath: text('storage_path').notNull()
	},
	(table) => [
		index('data_sets_report_id_idx').on(table.reportId),
		check('data_sets_format_check', sql`${table.sourceFormat} in ('csv', 'json', 'xlsx')`)
	]
);

export type DataSetRow = typeof dataSets.$inferSelect;

// A share link (FR17/FR21/NFR6) points a reader at a published report. The raw
// token lives ONLY in the share URL handed out once at creation; the table
// stores its SHA-256 hash (D5, same hash-at-rest as the sessions token), so a
// database leak exposes no usable link. `token_hash` is uniquely indexed - the
// reader gate (story 3.3) resolves a share by hashing the URL token and looking
// it up here.
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
		index('access_records_report_id_idx').on(table.reportId)
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
		index('verification_tokens_share_id_idx').on(table.shareId)
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
// Author-scoped by intent (single-author MVP): no owner column yet, mirroring the
// 1.5 "Multi-author IDOR prep" backlog note - add owner/tenant when tenancy
// lands. `name` is the author-chosen label. `last_used_at` (null until first use)
// is stamped best-effort on each successful authentication; `revoked_at` (null =
// active) is set on revoke and the row is NEVER deleted (an audit trail). V1 is
// revoke-only, no expiry (backlog Epic 4 decision).
export const apiTokens = pgTable(
	'api_tokens',
	{
		id: uuid('id').primaryKey(),
		name: text('name').notNull(),
		tokenHash: text('token_hash').notNull(),
		displayFragment: text('display_fragment').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
		revokedAt: timestamp('revoked_at', { withTimezone: true })
	},
	(table) => [
		uniqueIndex('api_tokens_token_hash_idx').on(table.tokenHash),
		index('api_tokens_revoked_at_idx').on(table.revokedAt)
	]
);

export type ApiTokenRow = typeof apiTokens.$inferSelect;
