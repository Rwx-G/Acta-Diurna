import { expect, test } from '@playwright/test';
import { E2E_BASE_URL } from './fixtures.ts';

// Workspace "what changed since last issue" view (Story 9.3). The flow builds a
// REAL two-issue series through the UI - publish, duplicate (mints the predecessor
// edge, story 9.1), refill, publish - so the diff runs over two genuine published
// snapshots rather than hand-seeded rows. It then opens the author-facing view and
// asserts the changelog reflects the change, plus the first-issue neutral state.
//
// The POSTs go through Playwright's request context with an explicit Origin header
// to satisfy SvelteKit's CSRF origin check (see e2e/duplicate-report.e2e.ts).
async function postForm(
	page: import('@playwright/test').Page,
	url: string,
	form: Record<string, string>
): Promise<{ type?: string; location?: string; data?: string }> {
	const response = await page.request.post(url, {
		headers: { origin: E2E_BASE_URL, 'content-type': 'application/x-www-form-urlencoded' },
		form,
		maxRedirects: 0,
		failOnStatusCode: false
	});
	return (await response.json()) as { type?: string; location?: string; data?: string };
}

function idFromEditorRedirect(location: string | undefined): string {
	const id = location?.match(/^\/reports\/([0-9a-f-]+)\/edit$/)?.[1];
	expect(id).toBeTruthy();
	return id!;
}

/** A document with caller-fixed section/block ids so the duplicate inherits them and the diff matches by id. */
function documentJson(prose: string): string {
	return JSON.stringify({
		version: 1,
		title: 'Weekly Status',
		sections: [
			{
				id: 'summary',
				title: 'Summary',
				blocks: [{ type: 'text', id: 'intro', paragraphs: [[{ text: prose }]] }]
			}
		]
	});
}

test('the what-changed view shows the changelog for a refilled, republished issue', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	// First issue: create, set a controlled document with fixed ids, publish.
	const created = await postForm(page, `${E2E_BASE_URL}/reports/new`, {});
	const sourceId = idFromEditorRedirect(created.location);
	await postForm(page, `${E2E_BASE_URL}/reports/${sourceId}/edit?/save`, {
		document: documentJson('Old prose, the first edition.')
	});
	await postForm(page, `${E2E_BASE_URL}/reports/${sourceId}/edit?/publish`, {});

	// Next issue: duplicate (inherits the series + ids, predecessor = source),
	// refill the same block with new prose, publish.
	const duplicated = await postForm(page, `${E2E_BASE_URL}/reports?/duplicate`, { id: sourceId });
	const issueId = idFromEditorRedirect(duplicated.location);
	await postForm(page, `${E2E_BASE_URL}/reports/${issueId}/edit?/save`, {
		document: documentJson('New prose, the refilled edition.')
	});
	await postForm(page, `${E2E_BASE_URL}/reports/${issueId}/edit?/publish`, {});

	// Open the what-changed view for the current issue: the changelog shows the
	// kept section and the content change on the matched block.
	await page.goto(`/reports/${issueId}/changes`);
	const changelog = page.getByRole('region', {
		name: 'What changed since the previous issue'
	});
	await expect(changelog).toBeVisible();
	await expect(changelog).toContainText('Summary');
	await expect(changelog).toContainText('intro');
	await expect(changelog).toContainText('Content changed');

	// The neutral never-leak guard: the predecessor's prior prose is never shipped to
	// this view (the engine returns flags + ids only, no prior-issue block body).
	const body = await page.locator('body').innerText();
	expect(body).not.toContain('Old prose, the first edition.');
});

test('the what-changed view shows the first-issue neutral state for a fresh series', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	// A never-duplicated report is a one-issue series with no predecessor; once
	// published, the view shows the first-issue neutral state, not an empty page.
	const created = await postForm(page, `${E2E_BASE_URL}/reports/new`, {});
	const reportId = idFromEditorRedirect(created.location);
	await postForm(page, `${E2E_BASE_URL}/reports/${reportId}/edit?/publish`, {});

	await page.goto(`/reports/${reportId}/changes`);

	await expect(page.getByText('This is the first issue of the series')).toBeVisible();
});

test('the what-changed view shows the predecessor-unpublished neutral state', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	// The predecessor exists in the series but is still a DRAFT (never published), so
	// it has no frozen edition to diff against. Build it: create the source, leave it
	// a draft, duplicate it (the copy's predecessor is the still-draft source), then
	// publish only the copy. The copy's view shows the distinct predecessor-unpublished
	// state, not the first-issue one.
	const created = await postForm(page, `${E2E_BASE_URL}/reports/new`, {});
	const sourceId = idFromEditorRedirect(created.location);

	const duplicated = await postForm(page, `${E2E_BASE_URL}/reports?/duplicate`, { id: sourceId });
	const issueId = idFromEditorRedirect(duplicated.location);
	await postForm(page, `${E2E_BASE_URL}/reports/${issueId}/edit?/publish`, {});

	await page.goto(`/reports/${issueId}/changes`);

	await expect(page.getByText('The previous issue is not published yet')).toBeVisible();
});
