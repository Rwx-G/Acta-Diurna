import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { FIXTURE_REPORT_ID } from './fixtures.ts';

// Authenticated via the `setup` project storage state (config dependency).
const VIEW_URL = `/reports/${FIXTURE_REPORT_ID}/view`;

/**
 * The CI-gating a11y check (NFR14/15, architecture validation decision). Runs
 * axe-core over the rendered report against WCAG 2 A + AA. Report content
 * targets AAA on contrast; the design tokens are unit-tested for the 7:1
 * ratios, while axe here guards structure, names, roles and the AA floor on
 * the whole rendered surface.
 */
test('the rendered report has no axe-core violations (WCAG 2 A/AA)', async ({ page }) => {
	await page.goto(VIEW_URL);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

	const results = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
		.analyze();

	expect(results.violations).toEqual([]);
});

test('the table of contents overlay has no axe-core violations', async ({ page }) => {
	await page.goto(VIEW_URL);
	await page.locator('.report').click();
	await page.keyboard.press('t');
	await expect(page.getByRole('dialog', { name: 'Table of contents' })).toBeVisible();

	const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();

	expect(results.violations).toEqual([]);
});
