import { expect, test } from '@playwright/test';
import { DATA_AS_OF_CAPTION, DATA_AS_OF_FIXTURE_REPORT_ID } from './fixtures.ts';

// Data-as-of caption (Story 6.4, FR16) on the rendered reader surface. The
// `binding.dataAsOf` stamp is baked onto the document server-side, so the caption
// reads straight off the validated document - the fixture carries a table block with
// an explicit, deterministic `dataAsOf` and a kpi block with none. A bound block
// with a usable timestamp renders the "Data as of <date>" caption; a bound block
// with no timestamp renders no caption at all (omitted, never a placeholder).
//
// Authenticated via the `setup` project's storage state (config dependency).
const VIEW_URL = `/reports/${DATA_AS_OF_FIXTURE_REPORT_ID}/view`;

test('a bound block with an explicit data_as_of renders the formatted caption', async ({
	page
}) => {
	await page.goto(VIEW_URL);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

	// The stamped table section carries exactly one "Data as of <date>" caption with
	// the deterministic formatted date (fixed UTC instant, locale-independent).
	const stamped = page.locator('#stamped');
	await expect(stamped.locator('.data-as-of')).toHaveText(DATA_AS_OF_CAPTION);
});

test('a bound block with no usable timestamp renders no caption', async ({ page }) => {
	await page.goto(VIEW_URL);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

	// The unstamped kpi section is bound but carries no `dataAsOf`, so its block
	// renders zero captions - the treatment is omission, not a placeholder.
	const unstamped = page.locator('#unstamped');
	await expect(unstamped).toBeAttached();
	await expect(unstamped.locator('.data-as-of')).toHaveCount(0);
});
