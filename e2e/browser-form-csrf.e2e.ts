import { expect, test } from '@playwright/test';
import { E2E_AUTHOR_PASSWORD } from './fixtures.ts';

// Regression guard for the CSRF / referrer class of bug (the backlog
// "real-browser-form" item). The rest of the suite signs in through Playwright's
// APIRequestContext with an explicit Origin header (see auth.ts), which sidesteps
// SvelteKit's CSRF origin check and therefore cannot catch a referrer/origin
// regression. This spec submits the login form the way a human does - a real
// page.click() on the rendered <form>, letting the browser attach its own Origin
// header - so a reappearance of the `Referrer-Policy: no-referrer` bug (which made
// Chrome send `Origin: null` and 403 every form POST in production) fails here.
//
// Start from a clean, unauthenticated context (override the project's saved author
// storage state) so the login form actually renders and submits.
test.use({ storageState: { cookies: [], origins: [] } });

test('a real browser form POST is accepted (no CSRF/referrer regression)', async ({ page }) => {
	// One real login per run keeps the suite under the per-IP login rate-limit
	// brake (AR12); the browser Origin behavior under test is identical on mobile.
	test.skip(test.info().project.name !== 'desktop', 'one real login per run');

	await page.goto('/login');
	await page.fill('#password', E2E_AUTHOR_PASSWORD);

	// A native form submit (this form has no use:enhance) is a full-page POST that
	// carries the browser's own Origin header - exactly what SvelteKit's CSRF check
	// reads, and exactly what the APIRequestContext sign-in path never exercises.
	await page.click('button[type="submit"]');

	// Success is the 303 redirect to the workspace. A referrer/origin regression
	// would instead render SvelteKit's "Cross-site POST form submissions are
	// forbidden" 403 error page and never reach /reports.
	await expect(page).toHaveURL(/\/reports\/?$/);
	await expect(page.locator('body')).not.toContainText('forbidden');
});
