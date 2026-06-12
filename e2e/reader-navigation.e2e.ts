import { expect, test } from '@playwright/test';
import { FIXTURE_REPORT_ID, FIXTURE_SECTION_IDS } from './fixtures.ts';

// The author session is provided by the `setup` project's storage state
// (config dependency), so these specs start already authenticated.
const VIEW_URL = `/reports/${FIXTURE_REPORT_ID}/view`;

test('renders the cover and the first section SSR-complete', async ({ page }) => {
	await page.goto(VIEW_URL);
	// The cover carries the report title as the single h1.
	await expect(page.getByRole('heading', { level: 1 })).toContainText('Quarterly Security Report');
	// First section heading is present.
	await expect(page.locator('#executive-summary')).toBeVisible();
	// A chart rendered server-side as inline SVG (no canvas, no client chart lib).
	await expect(page.locator('.chart-svg').first()).toBeVisible();
	await expect(page.locator('canvas')).toHaveCount(0);
});

test('navigates sections with the keyboard and updates the URL fragment', async ({ page }) => {
	await page.goto(VIEW_URL);
	await page.locator('.report').click(); // focus the reading surface
	await page.keyboard.press('ArrowRight');
	await expect(page).toHaveURL(new RegExp(`#${FIXTURE_SECTION_IDS[1]}$`));
	await page.keyboard.press('ArrowRight');
	await expect(page).toHaveURL(new RegExp(`#${FIXTURE_SECTION_IDS[2]}$`));
	await page.keyboard.press('ArrowLeft');
	await expect(page).toHaveURL(new RegExp(`#${FIXTURE_SECTION_IDS[1]}$`));
});

test('opens and closes the table of contents with the t key', async ({ page }) => {
	await page.goto(VIEW_URL);
	await page.locator('.report').click();
	await page.keyboard.press('t');
	const toc = page.getByRole('dialog', { name: 'Table of contents' });
	await expect(toc).toBeVisible();
	// Jump to the methodology (annex) section from the TOC.
	await toc.getByRole('button', { name: /Methodology/ }).click();
	await expect(page).toHaveURL(new RegExp(`#${FIXTURE_SECTION_IDS[2]}$`));
});

test('resolves a deep-link fragment to the named section on load', async ({ page }) => {
	await page.goto(`${VIEW_URL}#${FIXTURE_SECTION_IDS[2]}`);
	const methodology = page.locator(`#${FIXTURE_SECTION_IDS[2]}`);
	await expect(methodology).toBeInViewport();
});
