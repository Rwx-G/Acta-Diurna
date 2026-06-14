import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { drizzle } from 'drizzle-orm/node-postgres';
import { inArray } from 'drizzle-orm';
import pg from 'pg';
import { hashToken } from '../src/lib/server/crypto/hash-token.ts';
import { accessRecords } from '../src/lib/server/db/schema.ts';
import { accessRecordCutoff, purgeAccessRecords } from '../src/lib/server/maintenance/purge.ts';
import {
	DB_URL_FILE,
	FIXTURE_REPORT_ID,
	RETENTION_AGED_RECORD_ID,
	RETENTION_FRESH_RECORD_ID,
	RETENTION_READER_EMAIL,
	RETENTION_READER_IDENTITY_ID,
	RETENTION_SHARE_ID
} from './fixtures.ts';

// Access-record retention DELETE (Story 6.3, FR24/FR38/NFR11), against the REAL
// testcontainer Postgres.
//
// WHY DIRECT INVOCATION. The retention DELETE runs in the boot sweep (runPurgeSweep
// in hooks.server.ts) ONLY when ACCESS_RECORD_RETENTION_DAYS is set; unset = the
// audit trail is kept indefinitely (the conservative default). The single-mode
// harness boots the app WITHOUT that env (global-setup.ts), so the boot sweep skips
// access_records and there is no in-process way to trigger it from a spec. The
// honest end-to-end closure is to call the real `purgeAccessRecords(db, now,
// retentionDays)` directly against the live container DB (the DB_URL_FILE seam),
// which is the exact function the boot sweep would run. This is a real-DB DELETE,
// not a mock: the query builder, the `lt(accessed_at, cutoff)` predicate and the
// row count all execute against Postgres.

const databaseUrl = readFileSync(DB_URL_FILE, 'utf8').trim();
const RETENTION_DAYS = 90;

test('purgeAccessRecords deletes only records older than the retention window', async () => {
	const pool = new pg.Pool({ connectionString: databaseUrl });
	try {
		const db = drizzle(pool);
		const now = new Date();
		const cutoff = accessRecordCutoff(now, RETENTION_DAYS);

		// One record comfortably OUTSIDE the window (aged), one comfortably INSIDE
		// it (fresh). A day either side of the cutoff, so the assertion is robust to
		// the wall clock advancing during the run.
		const agedAt = new Date(cutoff.getTime() - 24 * 60 * 60 * 1000);
		const freshAt = new Date(cutoff.getTime() + 24 * 60 * 60 * 1000);

		// Idempotent seed: the desktop and mobile project runs share one DB, so clear
		// these fixed-id rows first, then insert a known state. The dependency rows
		// (share, identity) are upserted; only the two access records are asserted on.
		await pool.query('delete from access_records where id = any($1)', [
			[RETENTION_AGED_RECORD_ID, RETENTION_FRESH_RECORD_ID]
		]);
		await pool.query(
			`insert into shares (id, report_id, token_hash, mode, created_at)
			 values ($1, $2, $3, 'open', now())
			 on conflict (id) do nothing`,
			[RETENTION_SHARE_ID, FIXTURE_REPORT_ID, hashToken(randomBytes(32).toString('base64url'))]
		);
		await pool.query(
			`insert into reader_identities (id, email, created_at, last_verified_at)
			 values ($1, $2, now(), now())
			 on conflict (id) do nothing`,
			[RETENTION_READER_IDENTITY_ID, RETENTION_READER_EMAIL]
		);
		await pool.query(
			`insert into access_records (id, reader_identity_id, share_id, report_id, accessed_at)
			 values
			   ($1, $5, $6, $7, $3),
			   ($2, $5, $6, $7, $4)`,
			[
				RETENTION_AGED_RECORD_ID,
				RETENTION_FRESH_RECORD_ID,
				agedAt.toISOString(),
				freshAt.toISOString(),
				RETENTION_READER_IDENTITY_ID,
				RETENTION_SHARE_ID,
				FIXTURE_REPORT_ID
			]
		);

		// The real DELETE against the live DB.
		const removed = await purgeAccessRecords(db, now, RETENTION_DAYS);
		expect(removed).toBeGreaterThanOrEqual(1);

		// The aged row is gone; the fresh row survives.
		const survivors = await db
			.select({ id: accessRecords.id })
			.from(accessRecords)
			.where(inArray(accessRecords.id, [RETENTION_AGED_RECORD_ID, RETENTION_FRESH_RECORD_ID]));
		const survivorIds = survivors.map((row) => row.id);

		expect(survivorIds).toContain(RETENTION_FRESH_RECORD_ID);
		expect(survivorIds).not.toContain(RETENTION_AGED_RECORD_ID);
	} finally {
		await pool.end();
	}
});
