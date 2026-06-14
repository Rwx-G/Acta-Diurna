import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { DETAIL_FIXTURE_REPORT_ID } from './fixtures.ts';

// In-report drill-down to and from a detail page (Epic 11, story 11.3) on the
// real reader shell. The detail fixture carries two `kind: 'detail'` sections
// reachable only through internal links (a table row, a matrix finding, an inline
// run); they SSR-render with their anchor ids but stay out of the main flow and
// the TOC. Authenticated via the `setup` project storage state (config
// dependency); the author `/view` renders the same `Report` shell a reader gets.
const VIEW_URL = `/reports/${DETAIL_FIXTURE_REPORT_ID}/view`;

const detailPage = (id: string) => `.detail-host:has(#${id})`;

test('detail sections SSR-render but stay out of the main flow and the TOC', async ({ page }) => {
	// The SSR floor: both detail sections ship in the served HTML (the report is
	// complete without JS), so a no-JS reader reaches them by anchor.
	const response = await page.request.get(VIEW_URL);
	const html = await response.text();
	expect(html).toContain('id="detail-weak-password"');
	expect(html).toContain('id="detail-open-port"');

	await page.goto(VIEW_URL);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

	// The detail page is hidden until targeted (CSS `:target`), so it never appears
	// between the cover and the close.
	await expect(page.locator(detailPage('detail-weak-password'))).toBeHidden();

	// The TOC lists only main-flow sections - no detail entry.
	await page.locator('.report').click();
	await page.keyboard.press('t');
	const toc = page.getByRole('dialog', { name: 'Table of contents' });
	await expect(toc).toBeVisible();
	await expect(toc.getByRole('button', { name: /Summary/ })).toBeVisible();
	await expect(toc.getByRole('button', { name: /Detail:/ })).toHaveCount(0);
	await page.keyboard.press('Escape');
});

test('activating a table-row internal link reveals the detail page and moves focus into it', async ({
	page
}) => {
	await page.goto(VIEW_URL);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

	const detail = page.locator(detailPage('detail-weak-password'));
	await expect(detail).toBeHidden();

	// The findings table's first finding links to its detail page.
	await page.getByRole('link', { name: 'Weak password policy' }).click();

	await expect(detail).toBeVisible();
	await expect(detail.getByRole('heading', { name: 'Detail: Weak password policy' })).toBeVisible();
	// Focus moved INTO the detail page (NFR15): the detail region holds focus.
	await expect(detail).toBeFocused();
});

test('activating a matrix-finding internal link reveals its detail page', async ({ page }) => {
	await page.goto(VIEW_URL);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

	await page.getByRole('link', { name: 'Open management port' }).first().click();

	const detail = page.locator(detailPage('detail-open-port'));
	await expect(detail).toBeVisible();
	await expect(detail).toBeFocused();
});

test('the back affordance returns to the origin section', async ({ page }) => {
	await page.goto(VIEW_URL);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

	// Drill down from the findings table (origin = the findings section).
	await page.getByRole('link', { name: 'Weak password policy' }).click();
	const detail = page.locator(detailPage('detail-weak-password'));
	await expect(detail).toBeVisible();

	await detail.getByRole('link', { name: /Back to the report/ }).click();

	// The detail page is hidden again and the origin section is back in view.
	await expect(detail).toBeHidden();
	await expect(page).toHaveURL(/#findings$/);
	await expect(page.locator('#findings')).toBeInViewport();
});

test('a deep link to a detail-section fragment opens the detail page directly on load', async ({
	page
}) => {
	await page.goto(`${VIEW_URL}#detail-open-port`);

	const detail = page.locator(detailPage('detail-open-port'));
	await expect(detail).toBeVisible();
	await expect(detail.getByRole('heading', { name: 'Detail: Open management port' })).toBeVisible();
	// Focus lands in the detail page even on a direct deep link.
	await expect(detail).toBeFocused();
});

test('the rendered report with an open detail page has no axe-core violations (WCAG 2 A/AA)', async ({
	page
}) => {
	await page.goto(`${VIEW_URL}#detail-weak-password`);
	await expect(page.locator(detailPage('detail-weak-password'))).toBeVisible();

	const results = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
		.analyze();

	expect(results.violations).toEqual([]);
});
