import { expect, type Page } from '@playwright/test';
import { E2E_AUTHOR_PASSWORD, E2E_BASE_URL } from './fixtures.ts';

/**
 * Signs in as the test author, leaving the page on an authenticated session.
 *
 * The login POST goes through Playwright's request context with an explicit
 * Origin header rather than the rendered form. Over plain HTTP (the e2e
 * server), Chrome strips the Origin to `null` on a form navigation because the
 * app sets `Referrer-Policy: no-referrer` - which trips SvelteKit's CSRF
 * origin check. Production serves over HTTPS, where the real Origin is sent and
 * the form works; this indirection is an HTTP-only test concession, not a
 * product workaround. The session cookie the response sets is shared with the
 * page via the browser context.
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
