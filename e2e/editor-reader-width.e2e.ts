import { expect, test } from '@playwright/test';
import { createDraft } from './helpers.ts';

// Per-report reader width (the gap: the /view and published reader were full-bleed with
// no per-report control). An author sets a fixed max width from the editor; it persists
// across a reload AND drives the reader render via the `--reader-width` override on the
// report root. Desktop-only surface (NFR27 is a reader requirement); a FRESH draft keeps
// the spec isolated.

test('sets a fixed reader width that persists and caps the /view render', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const reportId = await createDraft(page);
	const editPath = `/reports/${reportId}/edit`;
	await page.goto(editPath);

	// Open the reader-width popover, switch to Fixed, and pick the 1080 preset.
	await page.locator('.width-trigger').click();
	await page.getByRole('button', { name: 'Fixed' }).click();
	await page.locator('.chip', { hasText: '1080' }).click();

	// Save through the editor's own validated action, then reload: the choice persisted.
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByText('Saved at', { exact: false })).toBeVisible();

	await page.goto(editPath);
	await expect(page.getByRole('button', { name: 'Reader width (1080 px)' })).toBeVisible();

	// The reader view caps the report column at the chosen width via --reader-width.
	await page.goto(`/reports/${reportId}/view`);
	const reportRoot = page.locator('.report');
	await expect(reportRoot).toBeVisible();
	await expect(reportRoot).toHaveAttribute('style', /--reader-width:\s*1080px/);
});
