import { expect, test } from '@playwright/test';
import { E2E_BASE_URL } from './fixtures.ts';

// Authenticated via the `setup` project's storage state. Lean happy path for
// story 4.1 (D10/AR4/AR12): create a PAT in settings (shown once), use it as a
// Bearer on a real /api/v1 route (200), revoke it (401), and confirm an
// unauthenticated API call gets a 401 problem+json - NOT a 302 to /login.
//
// The settings POST goes through Playwright's request context with an explicit
// Origin header (the same HTTP-only CSRF concession the other workspace specs
// use over plain HTTP; production is HTTPS).
test('create a PAT, authenticate the API with it, then revoke', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const whoamiUrl = `${E2E_BASE_URL}/api/v1/whoami`;

	// No bearer -> 401 problem+json, NOT a redirect to /login.
	const noBearer = await page.request.get(whoamiUrl, {
		maxRedirects: 0,
		failOnStatusCode: false
	});
	expect(noBearer.status()).toBe(401);
	expect(noBearer.headers()['content-type']).toContain('application/problem+json');
	expect(noBearer.headers()['www-authenticate']).toContain('Bearer');

	// An author cookie alone (the request context carries the storage-state cookie)
	// does NOT authenticate the API: still 401 (strict realm separation).
	const cookieOnly = await page.request.get(whoamiUrl, {
		maxRedirects: 0,
		failOnStatusCode: false
	});
	expect(cookieOnly.status()).toBe(401);

	// Create a token via the settings UI; the raw token is shown once.
	await page.goto('/settings');
	await page.getByLabel('Token name').fill('e2e script');
	await page.getByRole('button', { name: 'Create token' }).click();
	const tokenCode = page.locator('.created-url');
	await expect(tokenCode).toBeVisible();
	const rawToken = (await tokenCode.textContent())!.trim();
	expect(rawToken).toMatch(/^acta_pat_[A-Za-z0-9_-]{43}$/);

	// The token is now listed (active) without exposing the raw value. Scope to THIS
	// token's row by its name: other specs in the suite mint tokens into the same
	// list, so an unscoped "active" assertion would resolve to several rows.
	const list = page.locator('.token-list');
	const row = list.locator('li').filter({ hasText: 'e2e script' });
	await expect(row.getByText('active')).toBeVisible();
	await expect(list).not.toContainText(rawToken);

	// Use the raw token as a Bearer on the real API route -> 200.
	const authed = await page.request.get(whoamiUrl, {
		headers: { authorization: `Bearer ${rawToken}` },
		maxRedirects: 0,
		failOnStatusCode: false
	});
	expect(authed.status()).toBe(200);
	const body = (await authed.json()) as { tokenId: string | null };
	expect(body.tokenId).toBeTruthy();

	// Revoke THIS token via the UI (two-click confirm), then it no longer
	// authenticates. Scoped to the "e2e script" row so a sibling spec's token in the
	// shared list is never the one revoked.
	await row.getByRole('button', { name: 'Revoke' }).click(); // arms
	await row.getByRole('button', { name: 'Confirm revoke?' }).click(); // confirms
	await expect(row.getByText('revoked')).toBeVisible();

	const afterRevoke = await page.request.get(whoamiUrl, {
		headers: { authorization: `Bearer ${rawToken}` },
		maxRedirects: 0,
		failOnStatusCode: false
	});
	expect(afterRevoke.status()).toBe(401);
});
