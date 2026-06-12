import { expect, type Page } from '@playwright/test';
import { E2E_AUTHOR_PASSWORD, E2E_BASE_URL } from './fixtures.ts';

/**
 * Signs in as the test author, leaving the page on an authenticated session.
 *
 * The login POST goes through Playwright's request context with an explicit
 * Origin header rather than the rendered form. Playwright's `request` API
 * (APIRequestContext) does not attach an Origin header the way a real browser
 * form navigation does, so we set it explicitly to satisfy SvelteKit's CSRF
 * origin check. The session cookie the response sets is shared with the page
 * via the browser context.
 *
 * NOTE: an earlier version of this comment claimed the app's
 * `Referrer-Policy: no-referrer` was the cause and that it only mattered over
 * plain HTTP. That was wrong on both counts: `no-referrer` made Chrome send
 * `Origin: null` on EVERY browser form POST (HTTP and HTTPS alike), which broke
 * login and authoring in production, not just the tests. Fixed by serving
 * `Referrer-Policy: same-origin` (src/hooks.server.ts). This e2e indirection
 * remains only because of the APIRequestContext behavior above.
 */
export async function signIn(page: Page): Promise<void> {
	const response = await page.request.post(`${E2E_BASE_URL}/login`, {
		headers: { origin: E2E_BASE_URL, 'content-type': 'application/x-www-form-urlencoded' },
		form: { password: E2E_AUTHOR_PASSWORD },
		maxRedirects: 0,
		failOnStatusCode: false
	});
	// A SvelteKit form action invoked over the request API returns its result as
	// JSON (HTTP 200) with the Set-Cookie applied to the context: success is a
	// `redirect` to /reports, a wrong password is a `failure`.
	const result = (await response.json()) as { type?: string; location?: string };
	expect(result.type, 'login should succeed').toBe('redirect');
	expect(result.location).toBe('/reports');
}
