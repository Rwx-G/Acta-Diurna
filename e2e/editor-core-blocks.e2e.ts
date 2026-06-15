import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { createDraft } from './helpers.ts';

// Story 10.3: per-block-type FIELD editing for the five CORE block types (text,
// table, chart, kpi, image). Each block is edited in place through its own
// affordance - text as inline runs with the schema's marks, a table as a grid, a
// chart as series config, a kpi as items, an image as its reference + alt - and
// every edit flows through the SAME validated working-copy + debounced-preview +
// validated-save seam the shell (10.1) established. The workspace editor is a
// desktop-only surface (NFR27 is a reader requirement), so this runs on the
// desktop project only. A FRESH draft is created per test so writes succeed.

test('edits each core block type in place, and the field edits persist across reload', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const reportId = await createDraft(page);
	const editPath = `/reports/${reportId}/edit`;
	await page.goto(editPath);

	// The split preview is off by default; open it to assert the live render.
	await page.getByRole('button', { name: 'Split preview' }).click();
	const preview = page.getByRole('complementary', { name: 'Live preview' });
	await expect(preview).toBeVisible();

	// TEXT: edit the seeded text block's first run, then toggle the BOLD inline mark.
	// The mark is the schema's vocabulary - no freeform HTML - so the preview renders
	// a <strong>, not arbitrary markup.
	const runText = 'Quarterly highlights';
	await page.getByLabel('Paragraph 1, run 1 text').fill(runText);
	await page.getByLabel('Paragraph 1, run 1 Bold').check();
	await expect(preview.locator('strong', { hasText: runText })).toBeVisible();

	// TABLE: add a table block from the palette and edit a cell value as a grid.
	await page.getByRole('button', { name: 'Add a Table block' }).click();
	const tableBlock = page.getByRole('article', { name: 'table block' });
	await expect(tableBlock).toBeVisible();
	await tableBlock.getByLabel('Row 1, Column 1').fill('EU revenue');

	// CHART: add a chart block, give its first series two points (a single point is a
	// degenerate zero-range axis), and edit a value.
	await page.getByRole('button', { name: 'Add a Chart block' }).click();
	const chartBlock = page.getByRole('article', { name: 'chart block' });
	await expect(chartBlock).toBeVisible();
	await chartBlock.getByRole('button', { name: 'Add point' }).click();
	await chartBlock.getByRole('button', { name: 'Add point' }).click();
	await chartBlock.getByLabel('Series 1 point 1 x').fill('Q1');
	await chartBlock.getByLabel('Series 1 point 1 y').fill('42');
	await chartBlock.getByLabel('Series 1 point 2 x').fill('Q2');
	await chartBlock.getByLabel('Series 1 point 2 y').fill('58');

	// KPI: add a kpi block and edit its first item's label and value.
	await page.getByRole('button', { name: 'Add a KPI block' }).click();
	const kpiBlock = page.getByRole('article', { name: 'kpi block' });
	await expect(kpiBlock).toBeVisible();
	await kpiBlock.getByLabel('KPI 1 label').fill('Uptime');
	await kpiBlock.getByLabel('KPI 1 value').fill('99.9');

	// IMAGE: add an image block, give it a valid asset reference, and edit its
	// REQUIRED alt text (the accessibility-relevant field).
	await page.getByRole('button', { name: 'Add a Image block' }).click();
	const imageBlock = page.getByRole('article', { name: 'image block' });
	await expect(imageBlock).toBeVisible();
	await imageBlock.getByLabel('Asset reference').fill('0190c0de-0000-7000-8000-000000000000');
	await imageBlock.getByLabel('Alt text (required)').fill('A quarterly revenue chart');

	// Let the debounced autosave drain first: clicking Save while an autosave is in
	// flight makes the editor CANCEL and queue the manual submit (an 800 ms-debounced
	// re-save) which a navigation would then abandon, so settle the network so the
	// explicit Save below is the single write we gate on. The live-preview aside is
	// `position: sticky` and on this tall, five-block page can overlap the Save
	// button's hit point; the button is visible and enabled (asserted), so a forced
	// click targets the SAVE PATH without the sticky sibling intercepting the pointer.
	await page.waitForLoadState('networkidle');
	const saveButton = page.getByRole('button', { name: 'Save', exact: true });
	await expect(saveButton).toBeEnabled();
	const savePosted = page.waitForResponse(
		(response) => response.url().includes('/edit?/save') && response.request().method() === 'POST'
	);
	await saveButton.click({ force: true });
	await savePosted;
	await page.waitForLoadState('networkidle');

	await page.goto(editPath);
	await expect(page.getByLabel('Paragraph 1, run 1 text')).toHaveValue(runText);
	await expect(page.getByLabel('Paragraph 1, run 1 Bold')).toBeChecked();
	await expect(
		page.getByRole('article', { name: 'table block' }).getByLabel('Row 1, Column 1')
	).toHaveValue('EU revenue');
	await expect(
		page.getByRole('article', { name: 'chart block' }).getByLabel('Series 1 point 1 y')
	).toHaveValue('42');
	await expect(
		page.getByRole('article', { name: 'kpi block' }).getByLabel('KPI 1 label')
	).toHaveValue('Uptime');
	await expect(
		page.getByRole('article', { name: 'image block' }).getByLabel('Alt text (required)')
	).toHaveValue('A quarterly revenue chart');
});

test('a missing image alt is the actionable validation issue at the block', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const reportId = await createDraft(page);
	await page.goto(`/reports/${reportId}/edit`);

	// Add an image block: its starter alt is empty, so the optimistic inline guidance
	// names the missing alt at the block (the accessibility-relevant field) before any
	// save round-trip.
	await page.getByRole('button', { name: 'Add a Image block' }).click();
	const imageBlock = page.getByRole('article', { name: 'image block' });
	await expect(imageBlock).toBeVisible();

	await expect(imageBlock.getByText('Alt text must not be empty.', { exact: false })).toBeVisible();
});

test('the core-block editors have no axe-core violations', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const reportId = await createDraft(page);
	await page.goto(`/reports/${reportId}/edit`);

	// Mount one of each core block type so the scan covers every core editor surface.
	for (const label of [
		'Add a Table block',
		'Add a Chart block',
		'Add a KPI block',
		'Add a Image block'
	]) {
		await page.getByRole('button', { name: label }).click();
	}
	await expect(page.getByRole('article', { name: 'image block' })).toBeVisible();

	// Scope the scan to the editing FORM (the per-block editors this story delivers).
	// The embedded live preview is the 10.1 surface, axe-gated on its own reader routes.
	const results = await new AxeBuilder({ page })
		.include('.editor-form')
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
		.analyze();

	expect(results.violations).toEqual([]);
});
