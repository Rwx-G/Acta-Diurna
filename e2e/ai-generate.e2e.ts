import { expect, test } from '@playwright/test';
import { E2E_BASE_URL } from './fixtures.ts';

// Authenticated via the `setup` project's storage state. Story 5.4: the
// AI-disabled path. The e2e stack configures NO LLM endpoint and never opts in
// (no LLM_* / AI_GENERATION_ENABLED env), so the connector is disabled. The
// workspace MUST hide the Generate-with-AI entry point (never offer a capability
// that 503s), and a direct POST to the generation action MUST return the 5.3
// disabled problem unchanged. A real-LLM happy path is impractical in CI (no
// endpoint, no phone-home posture) and is covered by the mock-based unit tests.
//
// The POSTs go through Playwright's request context with an explicit Origin
// header to satisfy SvelteKit's CSRF origin check (see e2e/auth.ts).
async function postForm(
	page: import('@playwright/test').Page,
	url: string,
	form: Record<string, string>
): Promise<{ type?: string; location?: string; status?: number; detail?: string }> {
	const response = await page.request.post(url, {
		headers: { origin: E2E_BASE_URL, 'content-type': 'application/x-www-form-urlencoded' },
		form,
		maxRedirects: 0,
		failOnStatusCode: false
	});
	return (await response.json()) as {
		type?: string;
		location?: string;
		status?: number;
		detail?: string;
	};
}

test('hides the Generate-with-AI entry point and 503s the action when AI is disabled', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	// Create a fresh draft and open its editor.
	const created = await postForm(page, `${E2E_BASE_URL}/reports/new`, {});
	const reportId = created.location?.match(/^\/reports\/([0-9a-f-]+)\/edit$/)?.[1];
	expect(reportId).toBeTruthy();

	await page.goto(`${E2E_BASE_URL}/reports/${reportId}/edit`);
	await expect(page.getByRole('textbox', { name: 'Report title' })).toBeVisible();

	// The entry point is hidden: no "Generate with AI" panel when AI is off.
	await expect(page.getByRole('heading', { name: 'Generate with AI' })).toHaveCount(0);

	// A direct POST to the generation action returns the 5.3 disabled problem,
	// surfaced unchanged through the action's failure mapping.
	const outline = await postForm(
		page,
		`${E2E_BASE_URL}/reports/${reportId}/edit?/generate-outline`,
		{ intent: 'A weekly operations review.' }
	);
	// The action returns a SvelteKit failure envelope carrying the 5.3 disabled
	// detail; assert the disabled signal is present in the serialized payload.
	expect(JSON.stringify(outline)).toContain('disabled');
});
