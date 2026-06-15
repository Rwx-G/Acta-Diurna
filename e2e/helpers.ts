/**
 * Shared e2e helpers for the workspace editor specs. The form-POST headers (the
 * HTTP-only CSRF Origin concession the workspace specs use) and the fresh-draft
 * factory are identical across the editor specs, so they live here and are
 * imported from one source rather than copied per file.
 */
import { expect, type Page } from '@playwright/test';
import { E2E_BASE_URL } from './fixtures.ts';

/** Origin + form content-type for a Playwright request-context POST to a SvelteKit action. */
export const FORM_HEADERS = {
	origin: E2E_BASE_URL,
	'content-type': 'application/x-www-form-urlencoded'
};

/**
 * Creates a fresh draft report and returns its id. A new draft per test keeps the
 * spec isolated from the shared fixtures and from other tests' writes.
 */
export async function createDraft(page: Page): Promise<string> {
	const created = await page.request.post(`${E2E_BASE_URL}/reports/new`, {
		headers: FORM_HEADERS,
		form: {},
		maxRedirects: 0,
		failOnStatusCode: false
	});
	const body = (await created.json()) as { location?: string };
	const reportId = body.location?.match(/^\/reports\/([0-9a-f-]+)\/edit$/)?.[1];
	expect(reportId).toBeTruthy();
	return reportId!;
}
