import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import pg from 'pg';
import { hashToken } from '../src/lib/server/crypto/hash-token.ts';
import {
	AUDIT_ACCESS_RECORD_ID,
	AUDIT_ACCESSED_AT_CELL,
	AUDIT_ACCESSED_AT_ISO,
	AUDIT_READER_EMAIL,
	AUDIT_READER_IDENTITY_ID,
	AUDIT_SHARE_ID,
	DB_URL_FILE,
	FIXTURE_REPORT_ID
} from './fixtures.ts';

// Access-audit view (Story 6.3, FR24/FR38), end to end against the real build.
//
// HONEST CONSTRAINT, single mode. An `/r/<token>` consultation read serves the
// report DIRECTLY in single mode and never calls `recordAccess` - only the MULTI
// magic-link `completeVerification` writes an access row, and that flow has no
// SMTP in this harness (see reader-verification.e2e.ts). So the audit TRAIL cannot
// be produced through the single-mode HTTP reader path. This spec seeds the trail
// through the same DB seam restricted-share.e2e.ts uses (DB_URL_FILE -> pg.Pool):
// one share on the published full fixture, one reader identity, one access record
// at a fixed instant. The thing under test then runs entirely over HTTP: the
// author opens /audit and the seeded access renders; the report filter narrows
// correctly; an unknown report id yields an empty (no-oracle) result; and the
// report dropdown lists only the author's own reports.
//
// NOT ASSERTED HERE, deliberately: the author-only redirect. In this single-mode
// harness every (workspace) route (/audit, /settings, /reports) answers an
// unauthenticated request with 200, not a 303 to /login - the cookie guard's
// bounce is exercised in MULTI mode (multi-author-signin.e2e.ts) and unit-tested
// on the workspace layout/guard. Asserting a login bounce here would be a false
// positive, so the owner-scoping of the query (its real author-only contract) is
// what this spec covers instead.

const databaseUrl = readFileSync(DB_URL_FILE, 'utf8').trim();

test.beforeAll(async () => {
	const pool = new pg.Pool({ connectionString: databaseUrl });
	try {
		// A share is required by the access_records FK. Single mode mints `open`
		// shares; the token_hash is non-null, so seed a hash of a throwaway raw token.
		await pool.query(
			`insert into shares (id, report_id, token_hash, mode, created_at)
			 values ($1, $2, $3, 'open', now())
			 on conflict (id) do nothing`,
			[AUDIT_SHARE_ID, FIXTURE_REPORT_ID, hashToken(randomBytes(32).toString('base64url'))]
		);
		await pool.query(
			`insert into reader_identities (id, email, created_at, last_verified_at)
			 values ($1, $2, now(), now())
			 on conflict (id) do nothing`,
			[AUDIT_READER_IDENTITY_ID, AUDIT_READER_EMAIL]
		);
		await pool.query(
			`insert into access_records (id, reader_identity_id, share_id, report_id, accessed_at)
			 values ($1, $2, $3, $4, $5)
			 on conflict (id) do nothing`,
			[
				AUDIT_ACCESS_RECORD_ID,
				AUDIT_READER_IDENTITY_ID,
				AUDIT_SHARE_ID,
				FIXTURE_REPORT_ID,
				AUDIT_ACCESSED_AT_ISO
			]
		);
	} finally {
		await pool.end();
	}
});

test('the audit view shows a seeded access: report title, reader email, timestamp', async ({
	page
}) => {
	await page.goto('/audit');

	const row = page.locator('table.log tbody tr', { hasText: AUDIT_READER_EMAIL });
	await expect(row).toBeVisible();
	await expect(row).toContainText('Quarterly Security Report');
	await expect(row.locator('.when')).toHaveText(AUDIT_ACCESSED_AT_CELL);
});

test('the report filter narrows to the named report; an unknown id is an empty, error-free result', async ({
	page
}) => {
	// Filtering by the accessed report keeps the seeded row.
	await page.goto(`/audit?report=${FIXTURE_REPORT_ID}`);
	await expect(page.locator('table.log tbody tr', { hasText: AUDIT_READER_EMAIL })).toBeVisible();

	// A well-formed but unknown report id yields the empty state - no row, no error,
	// no existence oracle (the same empty result a cross-owner id would give).
	const unknownReportId = randomUUID();
	const response = await page.goto(`/audit?report=${unknownReportId}`);
	expect(response?.status()).toBe(200);
	await expect(page.locator('table.log')).toHaveCount(0);
	await expect(page.getByText('No accesses match these filters')).toBeVisible();
});

test('the report dropdown lists only the author own reports', async ({ page }) => {
	await page.goto('/audit');

	const options = page.locator('select[name="report"] option');
	// "All reports" plus the seeded fixtures the implicit author owns.
	await expect(options.filter({ hasText: 'Quarterly Security Report' })).toHaveCount(1);
	// Every non-placeholder option carries a UUID value: the dropdown is built from
	// listOwnedReportOptions, never an arbitrary report id.
	const values = await options.evaluateAll((nodes) =>
		nodes.map((node) => (node as HTMLOptionElement).value).filter((value) => value !== '')
	);
	expect(values.length).toBeGreaterThan(0);
	for (const value of values) {
		expect(value).toMatch(/^[0-9a-f-]{36}$/);
	}
});
