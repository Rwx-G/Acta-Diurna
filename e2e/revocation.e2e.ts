import { expect, test } from '@playwright/test';
import { FIXTURE_REPORT_ID } from './fixtures.ts';

// Revocation & leak-free posture (story 3.5 + 8.4, FR20/NFR9/NFR10), end to end
// against the real build. The e2e harness runs SINGLE mode (no SMTP, see
// global-setup.ts), where a share is a consultation token: opening the link
// serves the report directly. The author then REVOKES the share. On the reader's
// very next load the SAME link serves the neutral page (404), the report title is
// gone from the HTML, and the cut-off is immediate - revocation has no cache
// window (reader responses are no-store). Single mode has no verified reader
// session; the consultation read is cut by the share going inactive.

test('revoke: a consultation link is cut off and serves the neutral page (no title leak)', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'share creation is desktop-only (workspace)');

	// Author creates a share. In single mode it is an open consultation token.
	await page.goto(`/reports/${FIXTURE_REPORT_ID}/share`);
	await page.getByRole('button', { name: 'Generate link' }).click();
	const linkCode = page.locator('.created-url');
	await expect(linkCode).toBeVisible();
	const shareUrl = (await linkCode.textContent())!.trim();
	const shareToken = shareUrl.match(/\/r\/([A-Za-z0-9_-]{43})$/)![1];

	const reader = await page.context().browser()!.newContext();
	const readerPage = await reader.newPage();
	try {
		// The consultation link serves the report directly (no email, no verify card).
		await readerPage.goto(`/r/${shareToken}`);
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
