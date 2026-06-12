import { expect, test } from '@playwright/test';
import { E2E_BASE_URL } from './fixtures.ts';

// Authenticated via the `setup` project's storage state. Lean happy path for
// story 2.2: save a skeleton from the composer, see it in the library, create a
// report from it, and confirm the new report opens in the editor. The skeleton
// document is posted as the serialized structure the JS composer sends; the
// library and editor pages asserted after each step are the real surfaces.
//
// The POSTs go through Playwright's request context with an explicit Origin
// header because the APIRequestContext does not set one automatically the way a
// real browser form navigation does; it satisfies SvelteKit's CSRF origin
// check. See e2e/auth.ts for the full note.
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

// A minimal valid skeleton: one section, one bound table block with placeholder
// fields and no data - exactly what the composer produces (no uploads yet).
function skeletonDocument(name: string): string {
	return JSON.stringify({
		version: 1,
		title: name,
		sections: [
			{
				id: 'metrics',
				title: 'Metrics',
				blocks: [
					{
						type: 'table',
						id: 'weekly-table',
						columns: [
							{ key: 'item', label: 'Item' },
							{ key: 'count', label: 'Count' }
						],
						binding: {
							fields: [
								{ name: 'item', type: 'string' },
								{ name: 'count', type: 'number' }
							]
						}
					}
				]
			}
		]
	});
}

test('saves a skeleton, lists it, and instantiates a report from it', async ({
	page
}, testInfo) => {
	// The workspace (composer + library) is desktop-only; the narrow mobile rail
	// clips the library list. Run this flow on the desktop project only.
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const name = `E2E Skeleton ${Date.now()}`;

	// Save the skeleton: the composer save action persists and redirects to the library.
	const saved = await postForm(page, `${E2E_BASE_URL}/skeletons/compose?/save`, {
		document: skeletonDocument(name)
	});
	expect(saved.type).toBe('redirect');
	expect(saved.location).toBe('/skeletons');

	// The library lists the new skeleton with a Create report action.
	await page.goto('/skeletons');
	await expect(page.getByText(name)).toBeVisible();

	// Instantiate a report: the action redirects to the new report's editor.
	const skeletonRow = page.locator('li', { hasText: name });
	const instantiateForm = skeletonRow.locator('form[action="?/instantiate"]');
	const skeletonId = await instantiateForm.locator('input[name="id"]').inputValue();

	const instantiated = await postForm(page, `${E2E_BASE_URL}/skeletons?/instantiate`, {
		id: skeletonId
	});
	expect(instantiated.type).toBe('redirect');
	expect(instantiated.location).toMatch(/^\/reports\/[0-9a-f-]+\/edit$/);

	// The instantiated report opens as an editable draft titled after the skeleton.
	await page.goto(instantiated.location!);
	await expect(page.getByText('draft', { exact: true })).toBeVisible();
	await expect(page.getByLabel('Report title')).toHaveValue(name);
});
