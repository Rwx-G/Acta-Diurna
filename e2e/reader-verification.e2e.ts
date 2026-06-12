import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import pg from 'pg';
import { hashToken } from '../src/lib/server/crypto/hash-token.ts';
import { DB_URL_FILE, E2E_BASE_URL, FIXTURE_REPORT_ID } from './fixtures.ts';

// Reader verification (story 3.3, FR18/FR22/FR23/NFR9), end to end against the
// real build. The author (storageState) creates a share on the published
// fixture report; an unauthenticated reader hits the gate, sees the themed
// VerifyCard, submits an email (neutral confirmation), then the magic link is
// exercised via a DB seam (the raw verification token is only ever emailed and
// stored hashed, so the spec inserts a token with a KNOWN raw value - documented
// in global-setup.ts). Clicking it lands the reader on the report; revisiting
// serves the report with NO re-verification (FR23).

async function postForm(
	page: import('@playwright/test').Page,
	url: string,
	form: Record<string, string>
): Promise<{ type?: string; data?: unknown }> {
	const response = await page.request.post(url, {
		headers: { origin: E2E_BASE_URL, 'content-type': 'application/x-www-form-urlencoded' },
		form,
		maxRedirects: 0,
		failOnStatusCode: false
	});
	return (await response.json()) as { type?: string; data?: unknown };
}

test('reader: VerifyCard -> email -> magic link -> report -> no re-verify', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'share creation is desktop-only (workspace)');

	// Author creates a share on the published fixture report.
	await page.goto(`/reports/${FIXTURE_REPORT_ID}/share`);
	await page.getByRole('button', { name: 'Generate link' }).click();
	const linkCode = page.locator('.created-url');
	await expect(linkCode).toBeVisible();
	const shareUrl = (await linkCode.textContent())!.trim();
	const shareToken = shareUrl.match(/\/r\/([A-Za-z0-9_-]{43})$/)![1];

	// A fresh browser context = an unauthenticated reader (no author cookie).
	const reader = await page.context().browser()!.newContext();
	const readerPage = await reader.newPage();
	try {
		// The gate shows the themed VerifyCard, not the report.
		await readerPage.goto(`/r/${shareToken}`);
		await expect(readerPage.getByRole('heading', { name: /enter your email/i })).toBeVisible();

		// Submitting an email returns the neutral confirmation (NFR9).
		const sent = await postForm(readerPage, `/r/${shareToken}?/request-verification`, {
			email: 'reader@example.com'
		});
		expect(sent.type).toBe('success');

		// DB seam: insert a verification token with a known raw value (the real one
		// went only to the unreachable SMTP relay, hashed at rest).
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

		// Clicking the magic link lands the reader on the report (the cover renders).
		await readerPage.goto(`/r/${shareToken}/verify?t=${rawVerification}`);
		await expect(readerPage).toHaveURL(new RegExp(`/r/${shareToken}$`));
		await expect(readerPage.getByRole('application')).toBeVisible();

		// FR23: revisiting the share serves the report directly, no VerifyCard.
		await readerPage.goto(`/r/${shareToken}`);
		await expect(readerPage.getByRole('application')).toBeVisible();
		await expect(readerPage.getByRole('heading', { name: /enter your email/i })).toHaveCount(0);
	} finally {
		await reader.close();
	}
});

test('reader: an unknown share token is a neutral 404', async ({ page }) => {
	const bogus = randomBytes(32).toString('base64url');
	const response = await page.request.get(`/r/${bogus}`, { failOnStatusCode: false });
	expect(response.status()).toBe(404);
});
