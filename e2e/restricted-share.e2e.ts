import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import pg from 'pg';
import { hashToken } from '../src/lib/server/crypto/hash-token.ts';
import { DB_URL_FILE, FIXTURE_REPORT_ID } from './fixtures.ts';

// Restricted, per-recipient sharing is UNAVAILABLE in single mode (story 8.4):
// with no SMTP there is no email to verify recipients against, so the service
// refuses a restricted share (createShare/setShareMode throw 409) and the share
// UI hides the restricted/open + recipient controls entirely. The e2e harness
// runs SINGLE mode (no SMTP, see global-setup.ts), so this spec asserts that
// single-mode reality at the HTTP boundary: the Access/Recipients controls are
// absent, the consultation behavior is explained, and a created share is stored
// `open`. The verified restricted flow (an on-list reader reads, an off-list
// reader gets the byte-identical neutral confirmation but no token) is MULTI mode
// only; its e2e coverage is a deferred follow-up that needs an SMTP-backed
// harness, and the service-level refusals are already unit-tested
// (shares.test.ts, share/page.server.test.ts).

test('single mode: restricted sharing is unavailable; a share is an open consultation token', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'share creation is desktop-only (workspace)');

	await page.goto(`/reports/${FIXTURE_REPORT_ID}/share`);

	// The single-mode share page explains consultation and hides the restricted
	// controls: no Access selector, no Recipients field (they exist only in MULTI).
	await expect(page.getByText('a share link is a consultation token')).toBeVisible();
	await expect(page.getByLabel('Access')).toHaveCount(0);
	await expect(page.getByLabel('Recipients')).toHaveCount(0);

	// Creating a share yields a consultation link.
	await page.getByRole('button', { name: 'Generate link' }).click();
	const linkCode = page.locator('.created-url');
	await expect(linkCode).toBeVisible();
	const shareUrl = (await linkCode.textContent())!.trim();
	const shareToken = shareUrl.match(/\/r\/([A-Za-z0-9_-]{43})$/)![1];

	// The newest listed share is shown as a consultation token, not restricted/open.
	const newestRow = page.locator('.share-list li').first();
	await expect(newestRow.locator('.mode')).toHaveText('consultation');

	// At rest the share is stored `open` (the only mode single mode mints), and it
	// carries no recipient allow-list - the restricted concept never materializes.
	const databaseUrl = readFileSync(DB_URL_FILE, 'utf8').trim();
	const pool = new pg.Pool({ connectionString: databaseUrl });
	try {
		const shareRow = await pool.query<{ id: string; mode: string }>(
			'select id, mode from shares where token_hash = $1 limit 1',
			[hashToken(shareToken)]
		);
		expect(shareRow.rows[0].mode).toBe('open');

		const recipients = await pool.query('select email from share_recipients where share_id = $1', [
			shareRow.rows[0].id
		]);
		expect(recipients.rowCount).toBe(0);
	} finally {
		await pool.end();
	}
});
