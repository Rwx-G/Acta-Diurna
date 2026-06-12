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
		check('data_sets_format_check', sql`${table.sourceFormat} in ('csv', 'json', 'xlsx')`)
	]
);

export type DataSetRow = typeof dataSets.$inferSelect;
