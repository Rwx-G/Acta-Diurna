import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Story 9.1: the series lineage model. The 0017 migration adds the `report_series`
// table and the `series_id` / `predecessor_id` / `issue_label` columns on `reports`,
// all additive and nullable (safe against pre-existing rows; a boot backfill assigns
// every report a series). These tests assert the migration is committed (so the boot
// migrator and the e2e testcontainer apply it), carries exactly that DDL, is
// registered in the journal, and that the schema source declares the model.

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIZZLE_DIR = join(HERE, '..', '..', '..', '..', 'drizzle');
const SCHEMA_FILE = join(HERE, 'schema.ts');
const MIGRATION = '0017_report_series_lineage';

describe('report series lineage migration (story 9.1)', () => {
	const sql = readFileSync(join(DRIZZLE_DIR, `${MIGRATION}.sql`), 'utf8');

	it('creates the report_series table with an owner FK', () => {
		expect(sql).toContain('CREATE TABLE "report_series"');
		expect(sql).toContain(
			'ALTER TABLE "report_series" ADD CONSTRAINT "report_series_owner_id_authors_id_fk"'
		);
	});

	it('adds the three lineage columns on reports, additive and nullable', () => {
		// No NOT NULL on any added column: the migration is safe against pre-existing
		// rows, which the boot backfill then assigns a series.
		expect(sql).toContain('ALTER TABLE "reports" ADD COLUMN "series_id" uuid;');
		expect(sql).toContain('ALTER TABLE "reports" ADD COLUMN "predecessor_id" uuid;');
		expect(sql).toContain('ALTER TABLE "reports" ADD COLUMN "issue_label" text;');
		expect(sql).not.toMatch(/ADD COLUMN "(series_id|predecessor_id|issue_label)"[^;]*NOT NULL/);
	});

	it('wires the series FK and the self-referencing predecessor FK', () => {
		expect(sql).toContain(
			'ALTER TABLE "reports" ADD CONSTRAINT "reports_series_id_report_series_id_fk"'
		);
		expect(sql).toContain(
			'ALTER TABLE "reports" ADD CONSTRAINT "reports_predecessor_id_reports_id_fk" FOREIGN KEY ("predecessor_id") REFERENCES "public"."reports"("id")'
		);
	});

	it('indexes the lineage lookup columns', () => {
		expect(sql).toContain(
			'CREATE INDEX "reports_series_id_idx" ON "reports" USING btree ("series_id")'
		);
		expect(sql).toContain(
			'CREATE INDEX "reports_predecessor_id_idx" ON "reports" USING btree ("predecessor_id")'
		);
		expect(sql).toContain(
			'CREATE INDEX "report_series_owner_id_idx" ON "report_series" USING btree ("owner_id")'
		);
	});

	it('is registered in the journal so the boot migrator applies it', () => {
		const journal: { entries: { tag: string }[] } = JSON.parse(
			readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8')
		);
		expect(journal.entries.some((entry) => entry.tag === MIGRATION)).toBe(true);
	});

	it('the schema source declares the model (the source of truth the migration was generated from)', () => {
		const schema = readFileSync(SCHEMA_FILE, 'utf8');
		expect(schema).toMatch(/export const reportSeries = pgTable\(\s*'report_series'/);
		expect(schema).toContain("seriesId: uuid('series_id')");
		expect(schema).toContain("predecessorId: uuid('predecessor_id')");
		expect(schema).toContain("issueLabel: text('issue_label')");
	});
});
