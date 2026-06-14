import { expect, test, type Page } from '@playwright/test';
import { FIXTURE_REPORT_ID } from './fixtures.ts';

// Audience levels (Story 6.1, FR28) on the real reader switcher. The author `/view`
// renders the SAME `Report` shell a reader gets (mode="slide", not embedded), so the
// LevelSwitcher in the chrome is the genuine control, and the seeded author session
// makes the workspace route the simplest surface to reach it. The full fixture
// carries audience tags: the executive-summary section is ['summary','full'] with a
// ['summary']-only kpi block inside it, the incident-analysis chart block carries no
// tag (every level), and the methodology section is ['technical'] (an annex).
// Visibility is asserted, not just the data-level attribute.
//
// Authenticated via the `setup` project's storage state (config dependency).
const VIEW_URL = `/reports/${FIXTURE_REPORT_ID}/view`;

// Block anchors are `${sectionId}--${blockId}`; section ids render verbatim.
const summaryOnlyKpi = (page: Page) => page.locator('#executive-summary--headline-indicators');
const untaggedChart = (page: Page) => page.locator('#incident-analysis--incidents-by-week');
const technicalSection = (page: Page) => page.locator('#methodology');

async function selectLevel(page: Page, label: string): Promise<void> {
	// The radio inputs are visually-hidden but operable (an a11y pattern), so force
	// past the visibility actionability check; the change still fires and drives the
	// data-level mechanism.
	await page
		.getByRole('group', { name: 'Reading level' })
		.first()
		.getByRole('radio', { name: label })
		.check({ force: true });
}

test('shows the level switcher only when the document carries audience tags', async ({ page }) => {
	await page.goto(VIEW_URL);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	// The tagged full fixture renders the switcher (hasAudiences true).
	await expect(page.getByRole('group', { name: 'Reading level' }).first()).toBeAttached();
});

test('hides technical-only content and shows full content at the default level', async ({
	page
}) => {
	await page.goto(VIEW_URL);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

	// Default level is `full`: the untagged chart is visible, the technical-only
	// methodology section and the summary-only kpi are hidden by CSS (display:none).
	await expect(untaggedChart(page)).toBeVisible();
	await expect(technicalSection(page)).toBeHidden();
	await expect(summaryOnlyKpi(page)).toBeHidden();
});

test('switching to technical reveals technical content and hides summary-only content', async ({
	page
}) => {
	await page.goto(VIEW_URL);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

	await selectLevel(page, 'Technical');
	await expect(technicalSection(page)).toBeVisible();
	await expect(summaryOnlyKpi(page)).toBeHidden();

	await selectLevel(page, 'Summary');
	await expect(summaryOnlyKpi(page)).toBeVisible();
	await expect(technicalSection(page)).toBeHidden();
});

test('a deep link to a technical-only section promotes the level and lands it in viewport', async ({
	page
}) => {
	// The regression guard: a fragment to a section tagged out of the default level
	// (#methodology is technical-only) must promote the reading level so the hidden
	// section gains a layout box and scrolls into view, rather than landing nowhere.
	await page.goto(`${VIEW_URL}#methodology`);
	const methodology = technicalSection(page);
	await expect(methodology).toBeVisible();
	await expect(methodology).toBeInViewport();
});

test('every level is present in the SSR DOM (audience hiding is presentation, not access control)', async ({
	page
}) => {
	// The no-JS/SSR floor: audience tags hide with CSS, they never gate delivery.
	// Even at the default `full` level, the technical-only block is in the page
	// source - assert via the served HTML, before any client toggling.
	const response = await page.request.get(VIEW_URL);
	const html = await response.text();
	// The technical-only methodology section and its block ship in the SSR HTML.
	expect(html).toContain('id="methodology"');
	expect(html).toContain('Counts are sourced from the SIEM export');
});
