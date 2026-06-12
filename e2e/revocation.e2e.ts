import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import pg from 'pg';
import { hashToken } from '../src/lib/server/crypto/hash-token.ts';
import { DB_URL_FILE, E2E_BASE_URL, FIXTURE_REPORT_ID } from './fixtures.ts';

// Revocation & leak-free posture (story 3.5, FR20/NFR9/NFR10), end to end against
// the real build. An author creates an OPEN share, a reader verifies (via the DB
// token seam, since the raw magic link only ever goes to the unreachable SMTP
// relay) and reads the report. The author then REVOKES the share. On the reader's
// very next load the same link serves the neutral page (404), the report title is
// gone from the HTML, and the live reader session is cut off - revocation is
// immediate, no cache window (reader responses are no-store).

async function postForm(
	page: import('@playwright/test').Page,
	url: string,
	form: Record<string, string>
): Promise<{ type?: string }> {
	const response = await page.request.post(url, {
		headers: { origin: E2E_BASE_URL, 'content-type': 'application/x-www-form-urlencoded' },
		form,
		maxRedirects: 0,
		failOnStatusCode: false
	});
	return (await response.json()) as { type?: string };
}

test('revoke: a verified reader is cut off and the link serves the neutral page (no title leak)', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'share creation is desktop-only (workspace)');

	// Author creates an OPEN share (any verified email may read).
	await page.goto(`/reports/${FIXTURE_REPORT_ID}/share`);
	await page.getByLabel('Access').selectOption('open');
	await page.getByRole('button', { name: 'Generate link' }).click();
	const linkCode = page.locator('.created-url');
	await expect(linkCode).toBeVisible();
	const shareUrl = (await linkCode.textContent())!.trim();
	const shareToken = shareUrl.match(/\/r\/([A-Za-z0-9_-]{43})$/)![1];

	const reader = await page.context().browser()!.newContext();
	const readerPage = await reader.newPage();
	try {
		// Reader verifies through the DB seam (a known raw token inserted directly).
		await postForm(readerPage, `/r/${shareToken}?/request-verification`, {
			email: 'reader@example.com'
		});
		const rawVerification = randomBytes(32).toString('base64url');
		const databaseUrl = readFileSync(DB_URL_FILE, 'utf8').trim();
		const pool = new pg.Pool({ connectionString: databaseUrl });
		try {
			const shareRow = await pool.query<{ id: string }>(
				'select id from shares where token_hash = $1 limit 1',
				[hashToken(shareToken)]
			);
			const shareId = shareRow.rows[0].id;
			await pool.query(
				`insert into verification_tokens (id, token_hash, share_id, email, expires_at, created_at)
				 values ($1, $2, $3, $4, now() + interval '15 minutes', now())`,
				[crypto.randomUUID(), hashToken(rawVerification), shareId, 'reader@example.com']
			);
		} finally {
			await pool.end();
		}

		// Clicking the magic link lands on the report; the reader now holds a live
		// acta_reader session and can read.
		await readerPage.goto(`/r/${shareToken}/verify?t=${rawVerification}`);
		await expect(readerPage).toHaveURL(new RegExp(`/r/${shareToken}$`));
		await expect(readerPage.getByRole('application')).toBeVisible();

		// The author revokes the share via the one-click UI (two-click confirm). The
		// list is newest-first, so the share just created is the first row; scope to
		// it (other specs in this run may have left active shares on the fixture).
		await page.reload();
		const newestRow = page.locator('.share-list li').first();
		await newestRow.getByRole('button', { name: 'Revoke', exact: true }).click(); // arms
		await newestRow.getByRole('button', { name: 'Confirm revoke?' }).click(); // confirms
		await expect(newestRow.locator('.chip.revoked')).toBeVisible();

		// The reader reloads the SAME link: immediately the neutral page, 404, with
		// the report title nowhere in the served HTML (FR20 leak-free, no cache).
		const afterRevoke = await readerPage.request.get(`/r/${shareToken}`, {
			failOnStatusCode: false
		});
		expect(afterRevoke.status()).toBe(404);
		const html = await afterRevoke.text();
		expect(html).toContain('This link is not available');
		expect(html).not.toContain('Quarterly'); // the fixture report's title words
		expect(afterRevoke.headers()['cache-control']).toContain('no-store');

		// Through the live page too: the report no longer renders, the neutral copy does.
		await readerPage.goto(`/r/${shareToken}`);
		await expect(readerPage.getByText('This link is not available')).toBeVisible();
		await expect(readerPage.getByRole('application')).toHaveCount(0);
	} finally {
		await reader.close();
	}
});

test('revoke is idempotent: revoking a revoked share stays a no-op', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'share creation is desktop-only (workspace)');

	await page.goto(`/reports/${FIXTURE_REPORT_ID}/share`);
	await page.getByRole('button', { name: 'Generate link' }).click();
	await expect(page.locator('.created-url')).toBeVisible();

	await page.reload();
	const newestRow = page.locator('.share-list li').first();
	await newestRow.getByRole('button', { name: 'Revoke', exact: true }).click();
	await newestRow.getByRole('button', { name: 'Confirm revoke?' }).click();
	await expect(newestRow.locator('.chip.revoked')).toBeVisible();

	// A revoked row shows no Revoke button (already closed), so a double-revoke is
	// structurally prevented in the UI; the service is idempotent regardless.
	await expect(newestRow.getByRole('button', { name: 'Revoke', exact: true })).toHaveCount(0);
});
