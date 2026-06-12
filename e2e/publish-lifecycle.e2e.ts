import { expect, test } from '@playwright/test';
import { E2E_BASE_URL } from './fixtures.ts';

// Authenticated via the `setup` project's storage state. Lean happy-path
// publish flow (story 1.7): create a draft, publish it, confirm the editor
// renders read-only/published, then unpublish back to an editable draft.
//
// The lifecycle POSTs go through Playwright's request context with an explicit
// Origin header, the same HTTP-only concession the auth helper uses: over plain
// HTTP the app's `Referrer-Policy: no-referrer` makes Chrome send `Origin: null`
// on a form navigation, tripping SvelteKit's CSRF check (production serves over
// HTTPS where the real Origin is sent). The rendered editor pages, asserted
// after each step, are the actual reader-facing surface.
async function postForm(
	page: import('@playwright/test').Page,
	url: string
): Promise<{ type?: string; location?: string }> {
	const response = await page.request.post(url, {
		headers: { origin: E2E_BASE_URL, 'content-type': 'application/x-www-form-urlencoded' },
		form: {},
		maxRedirects: 0,
		failOnStatusCode: false
	});
	return (await response.json()) as { type?: string; location?: string };
}

test('publishes a draft and unpublishes it back to editable', async ({ page }) => {
	// Create a fresh draft.
	const created = await postForm(page, `${E2E_BASE_URL}/reports/new`);
	expect(created.type).toBe('redirect');
	const editPath = created.location!;
	expect(editPath).toMatch(/\/reports\/[0-9a-f-]+\/edit$/);

	// The new report opens as an editable draft with the Publish CTA.
	await page.goto(editPath);
	await expect(page.getByText('draft', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();

	// Publish, then reload the editor: it is now published and read-only.
	const published = await postForm(page, `${E2E_BASE_URL}${editPath}?/publish`);
	expect(published.type).toBe('success');
	await page.goto(editPath);
	await expect(page.getByText('published', { exact: true })).toBeVisible();
	await expect(page.getByText('Published - unpublish to edit')).toBeVisible();

	// Unpublish, reload: back to an editable draft.
	const reverted = await postForm(page, `${E2E_BASE_URL}${editPath}?/unpublish`);
	expect(reverted.type).toBe('success');
	await page.goto(editPath);
	await expect(page.getByText('draft', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
});
