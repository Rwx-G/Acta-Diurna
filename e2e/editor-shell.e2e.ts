import { expect, test } from '@playwright/test';
import { E2E_BASE_URL } from './fixtures.ts';
import { createDraft, FORM_HEADERS } from './helpers.ts';

// Authenticated via the `setup` project's storage state. Story 10.1: the WYSIWYG
// editor SHELL - load into an editable working copy, an authoritative live
// preview rendered by the same pure renderer the reader uses, a validated save,
// optimistic-concurrency conflict detection, and the published read-only guard.
//
// The workspace editor is a desktop-only surface (NFR27 is a reader requirement),
// so this runs on the desktop project only - the same concession the other
// workspace specs use. A FRESH draft is created per test so writes succeed and
// the spec stays isolated from the shared fixtures.
//
// POSTs that bypass the browser form (the concurrency probe) go through
// Playwright's request context with an explicit Origin header (the HTTP-only CSRF
// concession the other workspace specs use).

function draftDocument(title: string): string {
	return JSON.stringify({
		version: 1,
		title,
		sections: [
			{
				id: 'overview',
				title: 'Overview',
				blocks: [{ type: 'text', id: 'intro', paragraphs: [[{ text: 'Shell paragraph.' }]] }]
			}
		]
	});
}

test('opens a draft, edits in place, saves, and the edit persists across a reload', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const reportId = await createDraft(page);
	const editPath = `/reports/${reportId}/edit`;

	await page.goto(editPath);

	// The editor loads into an editable working copy with the authoritative live
	// preview (the same pure renderer the reader uses): the seeded paragraph shows
	// in the preview pane.
	// The split preview is off by default; open it to assert the live render.
	await page.getByRole('button', { name: 'Split preview' }).click();
	const preview = page.getByRole('complementary', { name: 'Live preview' });
	await expect(preview).toBeVisible();

	// Make a shell-level edit (the report title) and let the debounced autosave run.
	const newTitle = `Shell Edited ${Date.now()}`;
	const titleInput = page.getByLabel('Report title');
	await titleInput.fill(newTitle);
	// The preview re-renders from the in-edit document: the new title appears in the
	// preview cover heading without a manual save.
	await expect(preview.getByRole('heading', { level: 1, name: newTitle })).toBeVisible();

	// Save explicitly and wait for the saved-at confirmation.
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByText('Saved at', { exact: false })).toBeVisible();

	// Reload: the persisted edit is what loads back.
	await page.goto(editPath);
	await expect(page.getByLabel('Report title')).toHaveValue(newTitle);
});

test('a stale expectedUpdatedAt save surfaces the concurrency conflict', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const reportId = await createDraft(page);
	const saveUrl = `${E2E_BASE_URL}/reports/${reportId}/edit?/save`;

	// First save establishes a known `updatedAt` (the new row's create time). Capture
	// the loaded timestamp BEFORE the write so the second save can replay it as stale.
	const reportRow = await page.request.get(`${E2E_BASE_URL}/reports/${reportId}/edit`);
	expect(reportRow.ok()).toBe(true);

	// Save once, capturing the resulting `savedAt` - the fresh server `updatedAt`.
	const firstSave = await page.request.post(saveUrl, {
		headers: FORM_HEADERS,
		form: { document: draftDocument('Concurrency First') }
	});
	const firstBody = (await firstSave.json()) as { type?: string; data?: string };
	expect(firstBody.type).toBe('success');
	// SvelteKit serializes the action data; the savedAt ISO is embedded in `data`.
	// Guard the extraction explicitly: if the serialization shape changes and the
	// regex stops matching, the test must FAIL loudly here rather than fall through
	// to a stale/undefined token that would silently exercise the single-writer path
	// (the whole point of this spec is the stale-token conflict).
	const savedAtMatch = JSON.stringify(firstBody).match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/);
	const firstSavedAt = savedAtMatch?.[0];
	expect(firstSavedAt, 'first save must surface an ISO savedAt to replay as a stale token').toMatch(
		/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/
	);

	// A concurrent write lands: a second save WITHOUT the stale token advances
	// `updatedAt` past `firstSavedAt`.
	const concurrent = await page.request.post(saveUrl, {
		headers: FORM_HEADERS,
		form: { document: draftDocument('Concurrency Second') }
	});
	expect(((await concurrent.json()) as { type?: string }).type).toBe('success');

	// Now replay a save asserting the STALE `firstSavedAt`: the service rejects it
	// with the 409 report-conflict instead of a silent last-writer-wins overwrite.
	const staleSave = await page.request.post(saveUrl, {
		headers: FORM_HEADERS,
		form: {
			document: draftDocument('Concurrency Stale'),
			expectedUpdatedAt: firstSavedAt!
		},
		failOnStatusCode: false
	});
	// A SvelteKit action `fail()` returns the status inside the body, not as the HTTP
	// status (the response is a 200 envelope carrying `{type:'failure', status}`).
	const staleBody = (await staleSave.json()) as { type?: string; status?: number };
	expect(staleBody.type).toBe('failure');
	expect(staleBody.status).toBe(409);
});

test('a published report is read-only in the editor', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const reportId = await createDraft(page);
	const editPath = `/reports/${reportId}/edit`;

	// Give it a valid document, then publish it.
	const save = await page.request.post(`${E2E_BASE_URL}${editPath}?/save`, {
		headers: FORM_HEADERS,
		form: { document: draftDocument(`Publish Shell ${Date.now()}`) }
	});
	expect(((await save.json()) as { type?: string }).type).toBe('success');
	const publish = await page.request.post(`${E2E_BASE_URL}${editPath}?/publish`, {
		headers: FORM_HEADERS,
		form: {},
		maxRedirects: 0,
		failOnStatusCode: false
	});
	expect(((await publish.json()) as { type?: string }).type).toBe('success');

	// The editor loads the published report read-only: the published note shows and
	// the editable fieldset is disabled (the title input cannot be edited).
	await page.goto(editPath);
	await expect(
		page.getByText('This report is published and read-only.', { exact: false })
	).toBeVisible();
	await expect(page.getByLabel('Report title')).toBeDisabled();

	// A document write to a published report is refused at the service (409), so the
	// editor never bypasses the lifecycle guard.
	const blockedSave = await page.request.post(`${E2E_BASE_URL}${editPath}?/save`, {
		headers: FORM_HEADERS,
		form: { document: draftDocument('Should Not Persist') },
		failOnStatusCode: false
	});
	const blockedBody = (await blockedSave.json()) as { type?: string; status?: number };
	expect(blockedBody.type).toBe('failure');
	expect(blockedBody.status).toBe(409);
});
