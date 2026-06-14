import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { DETAIL_FIXTURE_REPORT_ID } from './fixtures.ts';

// Audience levels and deep-link interaction on detail pages (Epic 11, story 11.4)
// on the real reader shell. The detail fixture carries TWO audience-tagged detail
// pages reachable only through an internal link: `detail-technical-only` is a
// section-level `['technical']` page (the whole host is hidden by the audience CSS
// until the level is promoted), and `detail-mixed-levels` is an untagged section
// whose only body block is `['technical']`-tagged (the host shows but its content
// is an empty box until promotion). The audience tags live ONLY on detail sections,
// so this fixture also proves detail-only tags surface the switcher (AC3).
//
// Authenticated via the `setup` project storage state (config dependency); the
// author `/view` renders the same `Report` shell a reader gets.
const VIEW_URL = `/reports/${DETAIL_FIXTURE_REPORT_ID}/view`;

const detailPage = (id: string) => `.detail-host:has(#${id})`;
const technicalOnlyBody = (page: Page) =>
	page.locator('#detail-technical-only--technical-only-body');
const mixedTechnicalBody = (page: Page) =>
	page.locator('#detail-mixed-levels--mixed-technical-body');

async function selectLevel(page: Page, label: string): Promise<void> {
	// The radio inputs are visually-hidden but operable. While a detail page is open
	// its fixed overlay sits above the chrome, so a synthetic pointer click is
	// intercepted by the overlay; focusing the radio and pressing Space drives the
	// change without a pointer hit, the keyboard path a real reader uses.
	const radio = page
		.getByRole('group', { name: 'Reading level' })
		.first()
		.getByRole('radio', { name: label });
	await radio.focus();
	await page.keyboard.press('Space');
}

test('a document whose audience tags live only on detail sections surfaces the level switcher (AC3)', async ({
	page
}) => {
	await page.goto(VIEW_URL);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	// The flow sections carry no tags, but the detail-only tags count (Epic 11
	// kickoff default), so the switcher is present and consistent with the flow rule.
	await expect(page.getByRole('group', { name: 'Reading level' }).first()).toBeAttached();
});

test('detail blocks show and hide by the same data-level CSS the flow uses (AC1)', async ({
	page
}) => {
	// Open the mixed-level detail page directly. Its body block is technical-only, so
	// the deep link promotes to technical (AC2/AC4) and the block is visible.
	await page.goto(`${VIEW_URL}#detail-mixed-levels`);
	const detail = page.locator(detailPage('detail-mixed-levels'));
	await expect(detail).toBeVisible();
	await expect(mixedTechnicalBody(page)).toBeVisible();

	// Switching down to summary hides the technical-only block by CSS (content stays
	// SSR, only visibility toggles - FR28 parity), while the detail host itself (an
	// untagged section) stays present at every level.
	await selectLevel(page, 'Summary');
	await expect(mixedTechnicalBody(page)).toBeHidden();
	await expect(detail).toBeVisible();

	// Back up to technical and the block reappears.
	await selectLevel(page, 'Technical');
	await expect(mixedTechnicalBody(page)).toBeVisible();
});

test('a deep link to a technical-only detail page promotes the level and lands on its content (AC2)', async ({
	page
}) => {
	// The shared-link case: the detail section is `['technical']`, hidden at the
	// default `full` level by the audience CSS (which out-specifies the :target
	// reveal). The load-time deep link must promote to technical BEFORE navigating,
	// so the link lands on content rather than an empty hidden box.
	await page.goto(`${VIEW_URL}#detail-technical-only`);

	const detail = page.locator(detailPage('detail-technical-only'));
	await expect(detail).toBeVisible();
	await expect(detail.getByRole('heading', { name: 'Detail: Technical deep dive' })).toBeVisible();
	await expect(technicalOnlyBody(page)).toBeVisible();
	// Focus lands in the detail page even when promotion was required.
	await expect(detail).toBeFocused();
});

test('clicking an internal link to a hidden technical-only detail promotes and reveals it (AC4)', async ({
	page
}) => {
	// The in-report drill-down case (not a load-time deep link): at the default
	// `full` level the target detail is hidden by its section tag. Activating the
	// link must promote the level the same way the deep link does, so the drill-down
	// never dead-ends on a hidden target.
	await page.goto(VIEW_URL);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

	const detail = page.locator(detailPage('detail-technical-only'));
	await expect(detail).toBeHidden();

	await page.getByRole('link', { name: 'technical-only deep dive' }).click();

	await expect(detail).toBeVisible();
	await expect(technicalOnlyBody(page)).toBeVisible();
	await expect(detail).toBeFocused();
});

test('clicking a link to a detail with a block-level tag promotes so the content is not an empty box (AC4)', async ({
	page
}) => {
	// The block-level edge: the detail SECTION is untagged (visible at every level),
	// but its sole body block is technical-only. At `full` the host shows but its
	// content is hidden. Promotion must raise the level to reveal the block.
	await page.goto(VIEW_URL);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

	await page.getByRole('link', { name: 'mixed-level appendix' }).click();

	const detail = page.locator(detailPage('detail-mixed-levels'));
	await expect(detail).toBeVisible();
	await expect(mixedTechnicalBody(page)).toBeVisible();
	await expect(detail).toBeFocused();
});

test('an audience-tagged detail page is in the SSR DOM at every level (presentation, not access control)', async ({
	page
}) => {
	// The no-JS/SSR floor: audience tags hide with CSS, they never gate delivery.
	// Even at the default `full` level, the technical-only detail content ships in
	// the page source - assert via the served HTML, before any client toggling.
	const response = await page.request.get(VIEW_URL);
	const html = await response.text();
	expect(html).toContain('id="detail-technical-only"');
	expect(html).toContain('answering unauthenticated probes');
});

test('the rendered report with an open audience-tagged detail page has no axe-core violations', async ({
	page
}) => {
	await page.goto(`${VIEW_URL}#detail-technical-only`);
	await expect(page.locator(detailPage('detail-technical-only'))).toBeVisible();

	const results = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
		.analyze();

	expect(results.violations).toEqual([]);
});
