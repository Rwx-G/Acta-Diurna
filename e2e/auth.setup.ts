import { test as setup } from '@playwright/test';
import { signIn } from './auth.ts';
import { AUTH_STATE } from './fixtures.ts';

/**
 * Authenticates once and saves the author session to storage state, which every
 * reader spec then reuses. Signing in once (rather than per test) keeps the
 * suite well under the login rate-limit brake (AR12) and mirrors the real "the
 * session persists" reader behavior.
 */
setup('authenticate as author', async ({ page }) => {
	await signIn(page);
	await page.context().storageState({ path: AUTH_STATE });
});
