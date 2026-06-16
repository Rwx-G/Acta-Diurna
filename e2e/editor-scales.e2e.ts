import { expect, test } from '@playwright/test';
import { createDraft } from './helpers.ts';

// In-editor document-level scales CRUD (the gap: scales were previously only writable
// through a whole-document PATCH, out of an in-browser author's reach). This exercises
// the round trip an author actually performs - declare a scale, give it a label, and
// confirm it persists across a reload through the SAME validated save path every other
// editor change uses. The workspace is a desktop-only surface (NFR27 is a reader
// requirement), so this runs on the desktop project only. A FRESH draft per test keeps
// the spec isolated.

test('declares a scale from the editor and it persists across a reload', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const reportId = await createDraft(page);
	const editPath = `/reports/${reportId}/edit`;
	await page.goto(editPath);

	// The Scales panel is a collapsed disclosure at the top of the editor; expand it.
	await page.locator('.scales-panel summary').first().click();

	// Declare a scale (default key + one entry), open its card, and give it a label.
	await page.getByRole('button', { name: 'Add scale' }).click();
	await page.locator('.scale-summary').first().click();
	await page.getByRole('textbox', { name: 'Scale 1 label' }).fill('Risk register');

	// Save through the editor's own validated action, then reload.
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByText('Saved at', { exact: false })).toBeVisible();

	await page.goto(editPath);
	await page.locator('.scales-panel summary').first().click();

	// The declared scale survived the round trip: exactly one scale card, its label
	// shown in the card summary.
	await expect(page.locator('.scale-card')).toHaveCount(1);
	await expect(page.locator('.scale-label-preview')).toHaveText('Risk register');
});
