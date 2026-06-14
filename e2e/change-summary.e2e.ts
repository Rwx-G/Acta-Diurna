import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
	CHANGE_SUMMARY_DISABLED_REPORT_ID,
	CHANGE_SUMMARY_ENABLED_REPORT_ID,
	CHANGE_SUMMARY_FIRST_ISSUE_REPORT_ID,
	CHANGE_SUMMARY_MOVEMENT_FIGURE
} from './fixtures.ts';

// Reader-facing change summary (Story 9.5) on the rendered surface. The
// `changeSummary.entries` are baked onto the published snapshot server-side at publish
// time (the `binding.delta` precedent) and read straight off the validated document by
// the PURE renderer - no client compute, and no prior-issue raw content is shipped, only
// the leak-safe facts (sections, verdicts, audience tags, and the already-baked deltas).
//
// The panel is OPT-IN and OFF by default: an opted-in issue with baked entries shows it,
// an opted-out issue shows none, and a first issue (no predecessor, no baked entries)
// shows none. The panel is audience-aware: an entry for a section hidden at the reader's
// level is hidden by the SAME audience CSS that hides the section.
//
// Authenticated via the `setup` project's storage state (config dependency).

async function selectLevel(page: Page, label: string): Promise<void> {
	await page
		.getByRole('group', { name: 'Reading level' })
		.first()
		.getByRole('radio', { name: label })
		.check({ force: true });
}

test('an opted-in issue with a predecessor shows the change-summary panel', async ({ page }) => {
	await page.goto(`/reports/${CHANGE_SUMMARY_ENABLED_REPORT_ID}/view`);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

	const panel = page.getByRole('region', { name: 'Changes since the previous issue' });
	await expect(panel).toBeVisible();
	// Sections added/updated since the previous issue.
	await expect(panel.locator('.change-summary-entry')).toHaveCount(3);
	await expect(panel).toContainText('Introduction');
	await expect(panel).toContainText('Metrics');
	await expect(panel).toContainText('Added');

	// The headline KPI movement: the signed figure (not colour alone) and the
	// accessible direction word.
	const movement = panel.locator('.movement.movement-up');
	await expect(movement).toBeVisible();
	await expect(movement.locator('.movement-figure')).toHaveText(CHANGE_SUMMARY_MOVEMENT_FIGURE);
	await expect(movement.locator('.sr-only')).toHaveText('up');
});

test('the opted-in panel never references a section the reader’s level hides (audience-aware)', async ({
	page
}) => {
	await page.goto(`/reports/${CHANGE_SUMMARY_ENABLED_REPORT_ID}/view`);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

	const techEntry = page.locator('.change-summary-entry[data-audiences="technical"]');
	// At the default full level, the technical-only entry is removed from layout by the
	// SAME audience CSS that hides the technical section - the summary never references a
	// section the reader's level conceals.
	await expect(techEntry).toBeHidden();
	// Promote to technical: the entry becomes visible, in lockstep with its section.
	await selectLevel(page, 'Technical');
	await expect(techEntry).toBeVisible();
});

test('an opted-out issue shows no change-summary panel', async ({ page }) => {
	await page.goto(`/reports/${CHANGE_SUMMARY_DISABLED_REPORT_ID}/view`);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page.locator('.change-summary')).toHaveCount(0);
});

test('a first issue with no baked entries shows no change-summary panel', async ({ page }) => {
	await page.goto(`/reports/${CHANGE_SUMMARY_FIRST_ISSUE_REPORT_ID}/view`);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page.locator('.change-summary')).toHaveCount(0);
});

test('the rendered change-summary panel passes axe-core (WCAG 2 A/AA)', async ({ page }) => {
	await page.goto(`/reports/${CHANGE_SUMMARY_ENABLED_REPORT_ID}/view`);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(
		page.getByRole('region', { name: 'Changes since the previous issue' })
	).toBeVisible();

	const results = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
		.analyze();

	expect(results.violations).toEqual([]);
});
