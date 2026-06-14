import { expect, test } from '@playwright/test';
import { PRESENTER_FIXTURE_REPORT_ID, PRESENTER_NOTES } from './fixtures.ts';

// Presenter view (Story 6.2, FR29) and the load-bearing notes-never-leak guard.
// The presenter route is author-only and owner-scoped; the seeded author owns the
// published presenter fixture (three sections with distinct speaker notes plus one
// annex section). The console shows the current section, its speaker notes, a
// next-section preview and an elapsed timer that advances. Meeting mode drops annex
// sections from the flow. The privacy assertion opens the SAME report on the reader
// path (a single-mode consultation share serves the published render directly) and
// proves the speaker-notes text is absent from the reader DOM AND the served HTML.
//
// Authenticated via the `setup` project's storage state (config dependency).
const PRESENT_URL = `/reports/${PRESENTER_FIXTURE_REPORT_ID}/present`;
const SHARE_URL = `/reports/${PRESENTER_FIXTURE_REPORT_ID}/share`;

test('the presenter console shows the section, notes, next preview, and an advancing timer', async ({
	page
}) => {
	await page.goto(PRESENT_URL);

	// The current section renders through the same reader component.
	await expect(page.getByRole('region', { name: 'Current section' })).toContainText('Introduction');
	// Its speaker notes are visible on the owner-scoped surface.
	await expect(page.getByLabel('Speaker notes')).toContainText(PRESENTER_NOTES.intro);
	// The next-section preview names the upcoming section.
	await expect(page.getByLabel('Next section')).toContainText('Findings');

	// The elapsed timer advances (wall-clock, ticks once per second).
	const timer = page.getByLabel('Elapsed time');
	await expect(timer).toHaveText('00:00');
	await expect(timer).not.toHaveText('00:00', { timeout: 5_000 });

	// Advancing to the next section swaps the notes to that section's notes. Drive
	// navigation by keyboard (the window-level grammar) so the assertion is layout
	// independent across the desktop grid and the stacked mobile layout.
	await page.keyboard.press('ArrowRight');
	await expect(page.getByRole('region', { name: 'Current section' })).toContainText('Findings');
	await expect(page.getByLabel('Speaker notes')).toContainText(PRESENTER_NOTES.findings);
});

test('meeting mode drops annex sections from the presented sequence', async ({ page }) => {
	await page.goto(PRESENT_URL);

	// Three sections present by default (intro, findings, methodology-annex).
	const position = page.locator('.position');
	await expect(position).toHaveText('1 / 3');

	// Toggle meeting mode (the 'm' key grammar): the single annex section
	// (methodology) leaves the flow.
	await page.keyboard.press('m');
	await expect(position).toHaveText('1 / 2');

	// Walking to the end never lands on the annex section.
	await page.keyboard.press('ArrowRight');
	await expect(page.getByRole('region', { name: 'Current section' })).toContainText('Findings');
	await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
	await expect(page.getByRole('region', { name: 'Current section' })).not.toContainText(
		'Methodology'
	);
	// Stepping past the end is clamped, so the annex never re-enters the sequence.
	await page.keyboard.press('ArrowRight');
	await expect(page.getByRole('region', { name: 'Current section' })).toContainText('Findings');
});

test('speaker notes never reach the reader render (the notes-never-leak guard)', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace share UI is desktop-only');

	// Mint a consultation share for the published presenter fixture through the UI,
	// then open the reader path it serves. In single mode a live open share grants
	// the published render directly (no email), so this is the real reader surface.
	await page.goto(SHARE_URL);
	await page.getByRole('button', { name: 'Generate link' }).click();
	const linkCode = page.locator('.created-url');
	await expect(linkCode).toBeVisible();
	const readerUrl = (await linkCode.textContent())!.trim();
	expect(readerUrl).toMatch(/\/r\/[A-Za-z0-9_-]{43}$/);

	const readerPath = new URL(readerUrl).pathname;

	// The rendered reader DOM carries none of the speaker-notes strings.
	await page.goto(readerPath);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	const body = await page.locator('body').innerText();
	for (const note of Object.values(PRESENTER_NOTES)) {
		expect(body).not.toContain(note);
	}

	// And neither does the serialized payload (the SSR HTML and hydration data):
	// the publish-serving chokepoint strips notes before they leave the server.
	const html = await (await page.request.get(readerPath)).text();
	for (const note of Object.values(PRESENTER_NOTES)) {
		expect(html).not.toContain(note);
	}
});
