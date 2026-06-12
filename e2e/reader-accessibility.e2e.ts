import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { FIXTURE_REPORT_ID, MATRIX_FIXTURE_REPORT_ID } from './fixtures.ts';

// Authenticated via the `setup` project storage state (config dependency).
const VIEW_URL = `/reports/${FIXTURE_REPORT_ID}/view`;
const MATRIX_VIEW_URL = `/reports/${MATRIX_FIXTURE_REPORT_ID}/view`;

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

/**
 * The comparison-matrix block (story 7.2) on the default theme: a pure SSR HTML
 * table whose cell formatting is computed from the document scales. axe gates
 * its table semantics (th/scope, caption), names and roles, and that colour is
 * never the sole signal (visually-hidden state labels). NFR14.
 */
test('the rendered comparison matrix has no axe-core violations (WCAG 2 A/AA)', async ({
	page
}) => {
	await page.goto(MATRIX_VIEW_URL);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page.getByRole('table')).toBeVisible();

	const results = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
		.analyze();

	expect(results.violations).toEqual([]);
});

/**
 * The field-grid header and the source legend (story 7.3) on the default theme.
 * The field grid is a semantic <dl> of escaped label/value pairs; the legend
 * renders one swatch per scale entry, each carrying its text label so colour is
 * never the sole signal. axe gates the metadata-list semantics, the swatch text
 * labels, and the AA floor. NFR14. The same fixture carries the matrix, so this
 * is the MVP correlation report (field grid + matrix + legend) rendered end to
 * end.
 */
test('the rendered field grid and legend have no axe-core violations (WCAG 2 A/AA)', async ({
	page
}) => {
	await page.goto(MATRIX_VIEW_URL);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page.getByText('Author', { exact: true })).toBeVisible();

	const results = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
		.analyze();

	expect(results.violations).toEqual([]);
});
