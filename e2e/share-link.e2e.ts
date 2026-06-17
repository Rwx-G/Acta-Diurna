import { expect, test } from '@playwright/test';
import { E2E_BASE_URL } from './fixtures.ts';

// Authenticated via the `setup` project's storage state. Lean happy path for
// story 3.2 (FR17/FR21): a draft refuses sharing with a "publish first"
// message; once published, creating a share returns a /r/[token] link shown
// once at creation AND re-displayable from the existing-links list so the owner
// can copy/re-send the SAME link later (re-displayable share links).
//
// The POSTs go through Playwright's request context with an explicit Origin
// header because the APIRequestContext does not set one automatically the way a
// real browser form navigation does; it satisfies SvelteKit's CSRF origin
// check. See e2e/auth.ts for the full note.
async function postForm(
	page: import('@playwright/test').Page,
	url: string,
	form: Record<string, string>
): Promise<{ type?: string; location?: string; data?: unknown }> {
	const response = await page.request.post(url, {
		headers: { origin: E2E_BASE_URL, 'content-type': 'application/x-www-form-urlencoded' },
		form,
		maxRedirects: 0,
		failOnStatusCode: false
	});
	return (await response.json()) as { type?: string; location?: string; data?: unknown };
}

test('a draft refuses sharing; a published report yields a one-time link', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	// A fresh draft.
	const created = await postForm(page, `${E2E_BASE_URL}/reports/new`, {});
	expect(created.type).toBe('redirect');
	const reportId = created.location!.match(/^\/reports\/([0-9a-f-]+)\/edit$/)?.[1];
	expect(reportId).toBeTruthy();

	const sharePath = `/reports/${reportId}/share`;

	// Draft: the share page shows the publish-first refusal, no link to generate.
	await page.goto(sharePath);
	await expect(page.getByText('Publish this report before sharing')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Generate link' })).toHaveCount(0);

	// Publish, then the create-share action returns a /r/[token] URL exactly once.
	const published = await postForm(page, `${E2E_BASE_URL}/reports/${reportId}/edit?/publish`, {});
	expect(published.type).toBe('success');

	await page.goto(sharePath);
	await expect(page.getByRole('button', { name: 'Generate link' })).toBeVisible();

	// Create a share via the page (UI), then read the one-time link off the page.
	await page.getByRole('button', { name: 'Generate link' }).click();
	const linkCode = page.locator('.created-url');
	await expect(linkCode).toBeVisible();
	const url = (await linkCode.textContent())!.trim();
	expect(url).toMatch(/\/r\/[A-Za-z0-9_-]{43}$/);

	// The share is now listed with an active status, and the SAME link is
	// re-displayed in the existing-links list with a copy control, so the owner can
	// re-send it without recreating. The link is byte-identical to the one shown at
	// creation (built from the at-rest cipher, decrypted server-side).
	const listing = page.locator('.share-list');
	await expect(listing.getByText('active')).toBeVisible();
	const listedLink = listing.locator('.link-input');
	await expect(listedLink).toHaveValue(url);
	await expect(listing.getByRole('button', { name: 'Copy link' })).toBeVisible();
});
