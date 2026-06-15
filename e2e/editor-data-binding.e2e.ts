import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { E2E_BASE_URL } from './fixtures.ts';
import { createDraft, seedDocument } from './helpers.ts';

// Story 10.5: data binding from the WYSIWYG editor. The author binds, rebinds and
// remaps a bindable block to an uploaded data set from WITHIN the editor, reusing
// the EXISTING bind / rebind / remap actions + diagnostics (no new binding engine).
// The editor reseeds its working copy from the re-resolved document and advances
// its concurrency token after each binding action, so a subsequent document save
// does not spuriously 409. The workspace is desktop-only (NFR27 is a reader
// requirement), so this runs on the desktop project only; a FRESH draft per test
// keeps writes isolated from the shared fixtures.

async function uploadCsv(page: Page, name: string, csv: string): Promise<string> {
	const response = await page.request.post(`${E2E_BASE_URL}/data-sets?/upload`, {
		headers: { origin: E2E_BASE_URL },
		multipart: { file: { name, mimeType: 'text/csv', buffer: Buffer.from(csv) } },
		failOnStatusCode: false
	});
	expect(response.ok()).toBe(true);
	const body = (await response.json()) as { type?: string; data?: string };
	expect(body.type).toBe('success');
	const ids = JSON.parse(body.data ?? '[]') as string[];
	const id = ids.find((entry) => /^[0-9a-f-]{36}$/.test(entry));
	expect(id).toBeTruthy();
	return id!;
}

const boundTableDocument = (title: string) => ({
	version: 1,
	title,
	sections: [
		{
			id: 'metrics',
			title: 'Metrics',
			blocks: [
				{
					type: 'table',
					id: 'severity-table',
					columns: [{ key: 'placeholder', label: 'Placeholder' }],
					binding: { fields: [{ name: 'severity', type: 'string' }] }
				}
			]
		}
	]
});

test('binds a table from the editor, renders bound in the preview, then remaps a drift in place', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const reportId = await createDraft(page);
	await seedDocument(page, reportId, boundTableDocument(`E2E Editor Binding ${Date.now()}`));

	// Upload the data sets BEFORE opening the editor so they appear in the editor's
	// loaded data-set list (the binder/refill panels read the server-loaded list; the
	// binding actions no longer invalidateAll, so the list is what the page loaded).
	await uploadCsv(page, 'initial.csv', 'severity,count\nCritical,4\nHigh,9');
	await uploadCsv(page, 'drifted.csv', 'severity,counts\nCritical,3\nLow,20');

	const editPath = `/reports/${reportId}/edit`;
	await page.goto(editPath);
	// The right pane shows the inspector by default; switch it to the preview ("Apercu")
	// to assert the live render. The binding state + remap then surface in the inspector
	// for the SELECTED block, so we switch back to "Inspecteur" once a block is selected.
	await page.getByRole('button', { name: 'Apercu' }).click();
	const preview = page.getByRole('complementary', { name: 'Live preview' });
	await expect(preview).toBeVisible();

	// BIND from the editor: pick the block + the initial data set, map both columns to
	// a column slot, and bind. The bind goes through the EXISTING `?/bind` action.
	const binder = page.locator('section[aria-label="Bind data"]');
	await binder.getByLabel('Data set').selectOption({ label: 'initial.csv' });
	await binder
		.getByRole('row', { name: /severity/ })
		.getByRole('combobox')
		.selectOption('column');
	await binder.getByRole('row', { name: /count/ }).getByRole('combobox').selectOption('column');
	const bindPosted = page.waitForResponse(
		(r) => r.url().includes('/edit?/bind') && r.request().method() === 'POST'
	);
	await binder.getByRole('button', { name: 'Bind block' }).click();
	await bindPosted;

	// The editor reseeded its working copy from the bound document, so the preview
	// re-renders the BOUND block (the data set's rows) without a reload.
	await expect(preview.getByText('Critical')).toBeVisible();
	await expect(preview.getByText('High')).toBeVisible();

	// The block now shows its bound-vs-static state as BOUND in the inspector (UX
	// redesign: the binding state moved off the card into the right pane). Select the
	// block, switch the pane back to the inspector, and assert the bound state there.
	const block = page.getByRole('article', { name: 'table block' });
	await block.click();
	await page.getByRole('button', { name: 'Inspecteur' }).click();
	const inspector = page.getByRole('complementary', { name: 'Inspector' });
	await expect(inspector.getByText('Bound to data set')).toBeVisible();

	// REFILL with a DRIFTED data set (count -> counts): the rebind re-resolves and the
	// per-block diagnostic chips turn amber. The refill goes through `?/rebind`.
	const refill = page.locator('section[aria-label="Refill data"]');
	await refill.locator('select').first().selectOption({ label: 'drifted.csv' });
	const rebindPosted = page.waitForResponse(
		(r) => r.url().includes('/edit?/rebind') && r.request().method() === 'POST'
	);
	await refill.getByRole('button', { name: 'Rebind from this data set' }).click();
	await rebindPosted;

	// The drift surfaces in the INSPECTOR for the selected block (Epic 10.5): an amber
	// chip naming the drift count. Open it to reach the inline remap. A rebind reseeds
	// the document, so re-select the block (the keyed card rebuilt) before reading the
	// inspector.
	await block.click();
	const blockChip = inspector.getByRole('button', { name: /Drifted/ });
	await expect(blockChip).toBeVisible();
	await blockChip.click();
	await expect(inspector.getByText('closest match')).toBeVisible();
	// The expected field "count" drifted; its closest available match in the drifted
	// set (severity, counts) is "counts", proposed as the remap target.
	await expect(inspector.locator('code.closest')).toHaveText('counts');

	// REMAP in place from the inspector's diagnostic: point the drifted "count" at the
	// available "counts". The remap goes through `?/remap`; the block re-resolves and
	// the chip clears.
	const remapForm = inspector.locator('form[action="?/remap"]');
	await remapForm.getByLabel('Map to').selectOption('counts');
	const remapPosted = page.waitForResponse(
		(r) => r.url().includes('/edit?/remap') && r.request().method() === 'POST'
	);
	await remapForm.getByRole('button', { name: 'Remap' }).click();
	await remapPosted;
	// The remap reseeds the document; re-select the block and assert the chip is gone.
	await block.click();
	await expect(inspector.getByRole('button', { name: /Drifted/ })).toHaveCount(0);

	// The binding persists: reload and the block is still bound to the data set. The
	// remap reconcile already cleared the editor (no pending save), so navigate straight.
	await page.goto(editPath);
	await page.getByRole('article', { name: 'table block' }).click();
	await expect(
		page.getByRole('complementary', { name: 'Inspector' }).getByText('Bound to data set')
	).toBeVisible();
});

test('a save after a binding action does not 409 (concurrency token reconciled)', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const reportId = await createDraft(page);
	await seedDocument(page, reportId, boundTableDocument(`E2E Binding Token ${Date.now()}`));
	await uploadCsv(page, 'initial.csv', 'severity,count\nCritical,4\nHigh,9');

	await page.goto(`/reports/${reportId}/edit`);
	const binder = page.locator('section[aria-label="Bind data"]');
	await binder.getByLabel('Data set').selectOption({ label: 'initial.csv' });
	await binder
		.getByRole('row', { name: /severity/ })
		.getByRole('combobox')
		.selectOption('column');
	const bindPosted = page.waitForResponse(
		(r) => r.url().includes('/edit?/bind') && r.request().method() === 'POST'
	);
	await binder.getByRole('button', { name: 'Bind block' }).click();
	await bindPosted;
	// The bound state shows in the inspector for the selected block (UX redesign).
	await page.getByRole('article', { name: 'table block' }).click();
	await expect(
		page.getByRole('complementary', { name: 'Inspector' }).getByText('Bound to data set')
	).toBeVisible();

	// A bind advanced the report's updatedAt. Without token reconciliation, the next
	// document save would assert the stale loaded timestamp and 409. Edit the title: the
	// edit schedules the 800 ms autosave. Wait for THAT save response explicitly (a
	// deterministic signal the in-flight save landed, not a flaky networkidle), then
	// assert it SUCCEEDED (200), proving the editor advanced expectedUpdatedAt after the
	// bind. The editor is clean again, so a subsequent explicit Save is unnecessary.
	const autosaveResponse = page.waitForResponse(
		(r) => r.url().includes('/edit?/save') && r.request().method() === 'POST'
	);
	await page.getByLabel('Report title').fill('Renamed After Bind');
	const response = await autosaveResponse;
	expect(response.status()).toBe(200);

	// The title edit persisted (not lost to a conflict) across reload.
	await page.goto(`/reports/${reportId}/edit`);
	await expect(page.getByLabel('Report title')).toHaveValue('Renamed After Bind');
});

test('the editor binding surface has no axe-core violations', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const reportId = await createDraft(page);
	await seedDocument(page, reportId, boundTableDocument(`E2E Binding Axe ${Date.now()}`));
	await uploadCsv(page, 'initial.csv', 'severity,count\nCritical,4\nHigh,9');
	await uploadCsv(page, 'drifted.csv', 'severity,counts\nCritical,3\nLow,20');

	await page.goto(`/reports/${reportId}/edit`);

	// Bind, then rebind with the drifted set so the per-block diagnostic chip + inline
	// remap are MOUNTED for the scan (the new editor binding surface this story adds).
	const binder = page.locator('section[aria-label="Bind data"]');
	await binder.getByLabel('Data set').selectOption({ label: 'initial.csv' });
	await binder
		.getByRole('row', { name: /severity/ })
		.getByRole('combobox')
		.selectOption('column');
	// Map "count" too so the drifted set (count -> counts) actually drifts and mounts
	// the per-block diagnostic chip + inline remap the scan needs to cover.
	await binder.getByRole('row', { name: /count/ }).getByRole('combobox').selectOption('column');
	await binder.getByRole('button', { name: 'Bind block' }).click();
	const block = page.getByRole('article', { name: 'table block' });
	// Select the block so the binding state + (after the rebind) the drift chip + inline
	// remap are MOUNTED in the inspector for the scan (the editor binding surface this
	// story adds, now hosted in the right-pane inspector).
	await block.click();
	const inspector = page.getByRole('complementary', { name: 'Inspector' });
	await expect(inspector.getByText('Bound to data set')).toBeVisible();

	const refill = page.locator('section[aria-label="Refill data"]');
	await refill.locator('select').first().selectOption({ label: 'drifted.csv' });
	await refill.getByRole('button', { name: 'Rebind from this data set' }).click();
	// The rebind reseeds the document; re-select the block, then open the drift chip.
	await block.click();
	await inspector.getByRole('button', { name: /Drifted/ }).click();
	await expect(inspector.getByText('closest match')).toBeVisible();

	// Scope the scan to the editor LAYOUT (the form stack AND the right-pane inspector),
	// since the binding state + diagnostic + inline remap now live in the inspector. The
	// embedded live preview is the 10.1 surface, axe-gated on its own reader routes.
	const results = await new AxeBuilder({ page })
		.include('.editor-layout')
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
		.analyze();

	expect(results.violations).toEqual([]);
});
