import { sql } from 'drizzle-orm';
import {
	check,
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
