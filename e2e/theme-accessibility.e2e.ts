import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { FIXTURE_REPORT_ID, MERIDIAN_FIXTURE_REPORT_ID } from './fixtures.ts';

// Authenticated via the `setup` project storage state (config dependency).
const AURORA_VIEW_URL = `/reports/${FIXTURE_REPORT_ID}/view`;
const MERIDIAN_VIEW_URL = `/reports/${MERIDIAN_FIXTURE_REPORT_ID}/view`;

/**
 * Non-default theme a11y (Story 6.5, FR39/NFR14). The renderer maps a document's
 * `theme` slug to a `data-theme` attribute, and the semantic `--report-*` tokens
 * carry the identity. The two non-default LIGHT themes are both gated under
 * axe-core against the same WCAG 2 A + AA tag set the default-theme reader spec
 * uses (AAA contrast is unit-tested on the design tokens; axe here guards
 * structure, names, roles and the AA floor on the whole rendered surface). Both
 * cases run on desktop AND mobile via the two Playwright projects.
 *
 *   - Cool Aurora: the shared full fixture is themed `aurora`, so this asserts the
 *     aurora token block against the FULL render (every block type, audience tags,
 *     an annex). It complements `reader-accessibility.e2e.ts`, which also opens the
 *     full fixture but frames its assertion around the default a11y contract; here
 *     the intent is explicitly the non-default theme.
 *   - Warm Meridian: a dedicated small fixture themed `meridian` (cover, KPI strip,
 *     rich-text marks, a scaleRef status table and a chip-cluster) so the meridian
 *     token block is gated without disturbing any other fixture's snapshots.
 */
test('the rendered report has no axe-core violations on the aurora theme (WCAG 2 A/AA)', async ({
	page
}) => {
	await page.goto(AURORA_VIEW_URL);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	// The aurora token block is applied via data-theme on the report root.
	await expect(page.locator(".report[data-theme='aurora']")).toBeVisible();

	const results = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
		.analyze();

	expect(results.violations).toEqual([]);
});

test('the rendered report has no axe-core violations on the meridian theme (WCAG 2 A/AA)', async ({
	page
}) => {
	await page.goto(MERIDIAN_VIEW_URL);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page.locator(".report[data-theme='meridian']")).toBeVisible();

	const results = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
		.analyze();

	expect(results.violations).toEqual([]);
});
