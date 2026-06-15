import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { createDraft } from './helpers.ts';

// Story 10.2: the block palette and STRUCTURAL editing (blocks and sections) -
// add from the palette, reorder with the keyboard-accessible move controls, and
// delete, every change flowing through the SAME validated working-copy + save path
// the shell (10.1) established. The workspace editor is a desktop-only surface
// (NFR27 is a reader requirement), so this runs on the desktop project only.
//
// A FRESH draft is created per test so writes succeed and the spec stays isolated.

test('adds a block from the palette, reorders and deletes it, and the structure persists across reload', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const reportId = await createDraft(page);
	const editPath = `/reports/${reportId}/edit`;
	await page.goto(editPath);

	const preview = page.getByRole('complementary', { name: 'Live preview' });
	await expect(preview).toBeVisible();

	// A fresh draft has one section with one empty text block. Add a KPI block from
	// the palette: it inserts a default-shaped kpi block at the end of the section.
	await page.getByRole('button', { name: 'Add a KPI block' }).click();
	await expect(page.getByRole('article', { name: 'kpi block' })).toBeVisible();

	// Add a Code block too, then reorder it up past the kpi block via the
	// keyboard-accessible move-up control (the NFR15 baseline).
	await page.getByRole('button', { name: 'Add a Code block' }).click();
	const codeBlock = page.getByRole('article', { name: 'code block' });
	await expect(codeBlock).toBeVisible();
	await codeBlock.getByRole('button', { name: 'Move block up' }).click();

	// The code block now precedes the kpi block in the editor's block order.
	const blockTypes = await page
		.getByRole('article')
		.evaluateAll((nodes) =>
			nodes
				.filter((node) => node.getAttribute('data-block-id'))
				.map((node) => node.getAttribute('aria-label'))
		);
	expect(blockTypes).toEqual(['text block', 'code block', 'kpi block']);

	// Delete the kpi block; the code and text blocks remain.
	await page
		.getByRole('article', { name: 'kpi block' })
		.getByRole('button', { name: 'Remove block' })
		.click();
	await expect(page.getByRole('article', { name: 'kpi block' })).toHaveCount(0);

	// Save and wait for the confirmation, then reload: the structure persisted.
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByText('Saved at', { exact: false })).toBeVisible();

	await page.goto(editPath);
	const reloaded = await page
		.getByRole('article')
		.evaluateAll((nodes) =>
			nodes
				.filter((node) => node.getAttribute('data-block-id'))
				.map((node) => node.getAttribute('aria-label'))
		);
	expect(reloaded).toEqual(['text block', 'code block']);
});

test('adds and deletes a section, and the structure persists across reload', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const reportId = await createDraft(page);
	const editPath = `/reports/${reportId}/edit`;
	await page.goto(editPath);

	// A fresh draft has one section. Add a second; it seeds with one empty text block.
	await expect(page.getByRole('region', { name: /^Section:/ })).toHaveCount(1);
	await page.getByRole('button', { name: 'Add section', exact: true }).click();
	await expect(page.getByRole('region', { name: /^Section:/ })).toHaveCount(2);

	// Save and reload: the two sections persisted.
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByText('Saved at', { exact: false })).toBeVisible();
	await page.goto(editPath);
	await expect(page.getByRole('region', { name: /^Section:/ })).toHaveCount(2);

	// Delete the second section, save, reload: back to one section.
	await page.getByRole('button', { name: 'Remove section' }).nth(1).click();
	await expect(page.getByRole('region', { name: /^Section:/ })).toHaveCount(1);
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByText('Saved at', { exact: false })).toBeVisible();
	await page.goto(editPath);
	await expect(page.getByRole('region', { name: /^Section:/ })).toHaveCount(1);
});

test('a keyboard-only block move reorders the structure', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const reportId = await createDraft(page);
	await page.goto(`/reports/${reportId}/edit`);

	// Add a second block so there is something to move; the draft starts with one
	// text block.
	await page.getByRole('button', { name: 'Add a Callout block' }).click();
	await expect(page.getByRole('article', { name: 'callout block' })).toBeVisible();

	// Focus the callout block's move-up control and activate it with the keyboard
	// only (Enter), the NFR15 baseline - no pointer drag involved.
	const moveUp = page
		.getByRole('article', { name: 'callout block' })
		.getByRole('button', { name: 'Move block up' });
	await moveUp.focus();
	await page.keyboard.press('Enter');

	const order = await page
		.getByRole('article')
		.evaluateAll((nodes) =>
			nodes
				.filter((node) => node.getAttribute('data-block-id'))
				.map((node) => node.getAttribute('aria-label'))
		);
	expect(order).toEqual(['callout block', 'text block']);
});

test('a keyboard-only section move reorders the structure', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const reportId = await createDraft(page);
	await page.goto(`/reports/${reportId}/edit`);

	// A fresh draft has one section; add a second so there is something to move. The
	// new section seeds as "New section".
	await expect(page.getByRole('region', { name: /^Section:/ })).toHaveCount(1);
	await page.getByRole('button', { name: 'Add section', exact: true }).click();
	await expect(page.getByRole('region', { name: 'Section: New section' })).toBeVisible();

	// Focus the FIRST section's "Move section down" control and activate it with the
	// keyboard only (Enter), the NFR15 baseline - no pointer drag involved. The first
	// section is the original draft section ("New report" / "Untitled").
	const moveDown = page.getByRole('button', { name: 'Move section down' }).first();
	await moveDown.focus();
	await page.keyboard.press('Enter');

	// "New section" now precedes the original draft section in the editor's order.
	const order = await page
		.getByRole('region', { name: /^Section:/ })
		.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
	expect(order[0]).toBe('Section: New section');
});

test('the editor surface with the block palette has no axe-core violations', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const reportId = await createDraft(page);
	await page.goto(`/reports/${reportId}/edit`);
	await expect(page.getByRole('group', { name: /^Add a block to/ }).first()).toBeVisible();

	// Scope the scan to the editing FORM - the palette and structural controls this
	// story delivers. The embedded live preview (`.editor-preview`) is the 10.1
	// surface (it renders the reader output, axe-gated on its own reader routes); its
	// scrollable preview frame is out of this story's scope.
	const results = await new AxeBuilder({ page })
		.include('.editor-form')
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
		.analyze();

	expect(results.violations).toEqual([]);
});
