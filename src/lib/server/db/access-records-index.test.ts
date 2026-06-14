import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// E7: `listAccessRecords` filters by report and orders by accessed_at DESC under a
// keyset cursor, but `access_records` had no composite index for that scan. The
// 0016 migration adds two: (report_id, accessed_at) for the report-scoped ordered
// page and (accessed_at, id) for the keyset order + tiebreak. These tests assert
// the migration is committed (so the boot migrator applies it) and carries exactly
// those index DDLs, and that the schema source declares them.

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIZZLE_DIR = join(HERE, '..', '..', '..', '..', 'drizzle');
const SCHEMA_FILE = join(HERE, 'schema.ts');

const REPORT_TIME_IDX = 'access_records_report_id_accessed_at_idx';
const TIME_ID_IDX = 'access_records_accessed_at_id_idx';

describe('access_records composite index migration (E7)', () => {
	it('the 0016 migration exists and creates both composite indexes', () => {
		const sql = readFileSync(join(DRIZZLE_DIR, '0016_stormy_rhodey.sql'), 'utf8');

		expect(sql).toContain(
			`CREATE INDEX "${REPORT_TIME_IDX}" ON "access_records" USING btree ("report_id","accessed_at")`
		);
		expect(sql).toContain(
			`CREATE INDEX "${TIME_ID_IDX}" ON "access_records" USING btree ("accessed_at","id")`
		);
	});

	it('the migration is registered in the journal so the boot migrator applies it', () => {
		const journal: { entries: { tag: string }[] } = JSON.parse(
			readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8')
		);
		expect(journal.entries.some((entry) => entry.tag === '0016_stormy_rhodey')).toBe(true);
	});

	it('the schema source declares both indexes (source of truth the migration was generated from)', () => {
		const schema = readFileSync(SCHEMA_FILE, 'utf8');
		expect(schema).toContain(REPORT_TIME_IDX);
		expect(schema).toContain(TIME_ID_IDX);
	});
});
