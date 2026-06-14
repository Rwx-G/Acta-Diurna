import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
	DELTA_FIRST_ISSUE_REPORT_ID,
	DELTA_SECOND_ISSUE_FIGURE,
	DELTA_SECOND_ISSUE_REPORT_ID
} from './fixtures.ts';

// Numeric delta annotation (Story 9.4) on the rendered surface. The `binding.delta`
// is precomputed onto the binding server-side at publish time (the `data_as_of`
// precedent) and read straight off the validated document by the PURE renderer - no
// client compute, and the prior issue's raw data is never shipped to the reader, only
// the baked delta. The first issue carries no delta (no predecessor), so its KPI shows
// the value alone; the second issue carries a baked up-delta, so its KPI shows the up
// arrow + signed figure with the accessible direction word.
//
// Authenticated via the `setup` project's storage state (config dependency).

test('a first issue with no predecessor renders no delta indicator', async ({ page }) => {
	await page.goto(`/reports/${DELTA_FIRST_ISSUE_REPORT_ID}/view`);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

	// The bound KPI renders its value, but no delta indicator at all (omitted, never a
	// misleading zero).
	const kpi = page.locator('.kpi');
	await expect(kpi).toBeVisible();
	await expect(kpi.locator('.value')).toHaveText('1000000');
	await expect(page.locator('.kpi-delta')).toHaveCount(0);
});

test('a later issue renders the up delta with an accessible direction and signed figure', async ({
	page
}) => {
	await page.goto(`/reports/${DELTA_SECOND_ISSUE_REPORT_ID}/view`);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

	const indicator = page.locator('.kpi-delta.kpi-delta-up');
	await expect(indicator).toBeVisible();

	// The signed figure carries the direction in text (not colour alone), and the
	// visually-hidden word carries it for assistive tech (NFR14).
	await expect(indicator.locator('.figure')).toHaveText(DELTA_SECOND_ISSUE_FIGURE);
	await expect(indicator.locator('.sr-only')).toHaveText('up');
});

test('the rendered delta indicator passes axe-core (WCAG 2 A/AA, not colour alone)', async ({
	page
}) => {
	await page.goto(`/reports/${DELTA_SECOND_ISSUE_REPORT_ID}/view`);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page.locator('.kpi-delta')).toBeVisible();

	const results = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
		.analyze();

	expect(results.violations).toEqual([]);
});
