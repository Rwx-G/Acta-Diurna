import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { FIXTURE_REPORT_ID } from './fixtures.ts';

// Single-mode consultation read (story 8.4, FR18/NFR9/NFR10), end to end against
// the real build. The e2e harness runs SINGLE mode (no SMTP, see global-setup.ts),
// where a share IS a consultation token: the author creates an `open` share on the
// published fixture report and an unauthenticated reader opens `/r/<token>` to get
// the published report DIRECTLY - no VerifyCard, no email step, no magic link.
// The verified magic-link flow (Epic 3) is MULTI mode only and is not reachable in
// this harness. The reader surface stays no-store + noindex regardless.

test('consultation share: the link serves the report directly, no verification', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'share creation is desktop-only (workspace)');

	// Author creates a share on the published fixture report. In single mode the
	// share is always an `open` consultation token (createShare forces it).
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
		// Opening the link serves the published report DIRECTLY: the cover renders,
		// no VerifyCard, no email prompt (the consultation token is the grant).
		await readerPage.goto(`/r/${shareToken}`);
		await expect(readerPage.getByRole('application')).toBeVisible();
		await expect(readerPage.getByRole('heading', { name: /enter your email/i })).toHaveCount(0);

		// The served reader response is no-store (NFR10): a consultation read is
		// never cached by an intermediary, so a later revoke takes effect at once.
		const direct = await readerPage.request.get(`/r/${shareToken}`, { failOnStatusCode: false });
		expect(direct.status()).toBe(200);
		expect(direct.headers()['cache-control']).toContain('no-store');
		// noindex holds in both modes: the X-Robots-Tag header on /r/* keeps the
		// private artifact out of search indexes.
		expect(direct.headers()['x-robots-tag']).toContain('noindex');
	} finally {
		await reader.close();
	}
});

test('reader: an unknown share token is a neutral 404', async ({ page }) => {
	const bogus = randomBytes(32).toString('base64url');
	const response = await page.request.get(`/r/${bogus}`, { failOnStatusCode: false });
	expect(response.status()).toBe(404);
});
