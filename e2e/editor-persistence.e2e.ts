import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { E2E_BASE_URL } from './fixtures.ts';
import { createDraft, FORM_HEADERS, seedDocument } from './helpers.ts';

// Story 10.7: the editor persistence UX - in-tab undo/redo, the autosave status
// indicator, the concurrency-conflict path composing with undo, and publish from
// the editor. The workspace editor is a desktop-only surface (NFR27 is a reader
// requirement), so this runs on the desktop project only. A FRESH draft per test
// keeps the spec isolated. Bypass POSTs go through Playwright's request context
// with an explicit Origin header (the HTTP-only CSRF concession the other
// workspace specs use).

function draftDocument(title: string): string {
	return JSON.stringify({
		version: 1,
		title,
		sections: [
			{
				id: 'overview',
				title: 'Overview',
				blocks: [{ type: 'text', id: 'intro', paragraphs: [[{ text: 'Persisted paragraph.' }]] }]
			}
		]
	});
}

test('undo and redo step the document and the preview follows, then autosave confirms', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const reportId = await createDraft(page);
	await seedDocument(page, reportId, JSON.parse(draftDocument('Undo Baseline')));
	await page.goto(`/reports/${reportId}/edit`);

	// The split preview is off by default; open it to assert the live render.
	await page.getByRole('button', { name: 'Split preview' }).click();
	const preview = page.getByRole('complementary', { name: 'Live preview' });
	await expect(preview).toBeVisible();
	await expect(preview.getByRole('heading', { level: 1, name: 'Undo Baseline' })).toBeVisible();

	const titleInput = page.getByLabel('Report title');
	const undo = page.getByRole('button', { name: 'Undo', exact: true });
	const redo = page.getByRole('button', { name: 'Redo', exact: true });

	await expect(undo).toBeDisabled();

	// Edit the title; the preview re-renders and the edit settles into one undo step.
	await titleInput.fill('Undo Edited');
	await expect(preview.getByRole('heading', { level: 1, name: 'Undo Edited' })).toBeVisible();
	await expect(undo).toBeEnabled();

	// Undo: the document AND the preview revert to the baseline.
	await undo.click();
	await expect(titleInput).toHaveValue('Undo Baseline');
	await expect(preview.getByRole('heading', { level: 1, name: 'Undo Baseline' })).toBeVisible();
	await expect(redo).toBeEnabled();

	// Redo: the document and preview re-apply the edit. Wait for the redone state's
	// save to actually reach the server (an explicit Save flushes the pending
	// autosave deterministically) before reloading, so the assertion is not racing
	// the 800 ms debounce.
	await redo.click();
	await expect(titleInput).toHaveValue('Undo Edited');
	await expect(preview.getByRole('heading', { level: 1, name: 'Undo Edited' })).toBeVisible();

	const saveResponse = page.waitForResponse(
		(response) => response.url().includes('?/save') && response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await saveResponse;
	// The status indicator (an announced `role="status"` region) confirms the save.
	await expect(page.getByRole('status').filter({ hasText: 'Saved at' })).toBeVisible();

	// Reload: the redone (current) state is what the server holds.
	await page.goto(`/reports/${reportId}/edit`);
	await expect(page.getByLabel('Report title')).toHaveValue('Undo Edited');
});

test('a keyboard undo (Ctrl+Z) reverts the last edit', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const reportId = await createDraft(page);
	await seedDocument(page, reportId, JSON.parse(draftDocument('Keyboard Baseline')));
	await page.goto(`/reports/${reportId}/edit`);

	const titleInput = page.getByLabel('Report title');
	await titleInput.fill('Keyboard Edited');
	await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();

	// The document undo shortcut. The title field would carry its own native text
	// undo, so blur it first to target the document-level history.
	await titleInput.blur();
	await page.keyboard.press('Control+z');
	await expect(titleInput).toHaveValue('Keyboard Baseline');
});

test('a stale-token save surfaces the conflict and preserves the in-memory edits, and undo still works after', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const reportId = await createDraft(page);
	const editPath = `/reports/${reportId}/edit`;
	await seedDocument(page, reportId, JSON.parse(draftDocument('Conflict Baseline')));
	await page.goto(editPath);

	const titleInput = page.getByLabel('Report title');
	const undo = page.getByRole('button', { name: 'Undo', exact: true });

	// A concurrent writer advances the row's updatedAt BEFORE the editor makes its
	// first save, so the editor's loaded token is already stale. Doing it before the
	// UI edit removes the autosave-timing race: the editor's next save is guaranteed
	// to assert the stale token (no earlier success could have advanced it).
	const concurrent = await page.request.post(`${E2E_BASE_URL}${editPath}?/save`, {
		headers: FORM_HEADERS,
		form: { document: draftDocument('Concurrent Writer') }
	});
	expect(((await concurrent.json()) as { type?: string }).type).toBe('success');

	// Make an in-tab edit that builds an undo step and arms the debounced autosave.
	await titleInput.fill('Conflict Local Edit');
	await expect(undo).toBeEnabled();

	// The editor's debounced autosave lands with the stale token: the conflict banner
	// appears and the local edit is preserved (never a silent overwrite).
	const conflictBanner = page.getByRole('alert');
	await expect(conflictBanner).toContainText('modified since you loaded it');
	await expect(titleInput).toHaveValue('Conflict Local Edit');

	// Undo still composes after the conflict: it reverts the local edit without
	// corrupting the editor (the undo control is live, the title reverts).
	await undo.click();
	await expect(titleInput).toHaveValue('Conflict Baseline');

	// The conflict banner's reload path is available to reconcile.
	await expect(page.getByRole('button', { name: 'Reload latest' })).toBeVisible();
});

test('publish from the editor flips it read-only and removes the undo affordance', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const reportId = await createDraft(page);
	const editPath = `/reports/${reportId}/edit`;
	await seedDocument(
		page,
		reportId,
		JSON.parse(draftDocument(`Publish From Editor ${Date.now()}`))
	);
	await page.goto(editPath);

	// Publish from the editor's morphing primary action.
	await page.getByRole('button', { name: 'Publish', exact: true }).click();

	// The editor flips to read-only: the published note shows, the title is disabled,
	// and the undo/redo affordance is gone (no working-copy history on a published
	// report - the publish reseeded the baseline).
	await expect(
		page.getByText('This report is published and read-only.', { exact: false })
	).toBeVisible();
	await expect(page.getByLabel('Report title')).toBeDisabled();
	await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);

	// Unpublish returns to editing.
	await page.getByRole('button', { name: 'Unpublish', exact: true }).click();
	await expect(page.getByLabel('Report title')).toBeEnabled();
	await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
});

test('the persistence UX surface has no axe-core violations', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const reportId = await createDraft(page);
	await page.goto(`/reports/${reportId}/edit`);

	// Make an edit so the undo control is enabled and the status indicator has shown a
	// transition, then scan the editor chrome the persistence UX lives in (the identity
	// row with the title / status / save / publish and the grouped tool strip).
	await page.getByLabel('Report title').fill('Axe Persistence');
	await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();

	const results = await new AxeBuilder({ page })
		.include('.editor-chrome')
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
		.analyze();

	expect(results.violations).toEqual([]);
});
