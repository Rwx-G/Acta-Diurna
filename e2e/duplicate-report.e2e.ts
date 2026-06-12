import { expect, test } from '@playwright/test';
import { E2E_BASE_URL } from './fixtures.ts';

// Authenticated via the `setup` project's storage state. Lean happy path for
// story 2.3 (FR10): create a report, duplicate it from the list, and confirm
// the duplicate opens as a fresh editable draft titled like the source.
//
// The POSTs go through Playwright's request context with an explicit Origin
// header, the same HTTP-only concession the other workspace specs use (over
// plain HTTP the app's Referrer-Policy makes Chrome send `Origin: null`,
// tripping CSRF; production is HTTPS).
async function postForm(
	page: import('@playwright/test').Page,
	url: string,
	form: Record<string, string>
): Promise<{ type?: string; location?: string }> {
	const response = await page.request.post(url, {
		headers: { origin: E2E_BASE_URL, 'content-type': 'application/x-www-form-urlencoded' },
		form,
		maxRedirects: 0,
		failOnStatusCode: false
	});
	return (await response.json()) as { type?: string; location?: string };
}

test('duplicates a report into a fresh editable draft', async ({ page }, testInfo) => {
	// The workspace reports list is desktop-only; the narrow mobile rail clips the
	// per-row action buttons. Run this flow on the desktop project only.
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	// Create a report to duplicate; capture its id from the editor redirect.
	const created = await postForm(page, `${E2E_BASE_URL}/reports/new`, {});
	expect(created.type).toBe('redirect');
	const sourceId = created.location!.match(/^\/reports\/([0-9a-f-]+)\/edit$/)?.[1];
	expect(sourceId).toBeTruthy();

	// Duplicate it from the list action; the action redirects to the new editor.
	const duplicated = await postForm(page, `${E2E_BASE_URL}/reports?/duplicate`, {
		id: sourceId!
	});
	expect(duplicated.type).toBe('redirect');
	expect(duplicated.location).toMatch(/^\/reports\/[0-9a-f-]+\/edit$/);

	// The duplicate is a distinct report, opening as an editable draft.
	const duplicateId = duplicated.location!.match(/^\/reports\/([0-9a-f-]+)\/edit$/)?.[1];
	expect(duplicateId).not.toBe(sourceId);

	await page.goto(duplicated.location!);
	await expect(page.getByText('draft', { exact: true })).toBeVisible();
});
