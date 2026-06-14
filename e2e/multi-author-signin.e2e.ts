import { expect, test } from '@playwright/test';
import { clearMailbox, expectNoMail, getLatestMagicLink } from './mailpit.ts';

// Multi-mode author sign-in (Epic 8, story 8.3), end to end against the real build
// + a real SMTP capture (Mailpit). The single-mode harness can only unit-test this
// by forcing token state; here the magic link is genuinely emailed, captured by
// Mailpit, and clicked, so the whole path - login form -> email submission ->
// magic-link verify -> author session -> workspace - runs for real.
//
// In multi mode the password form is ABSENT and the email magic-link request form
// is present (the login `load` returns `multi: true`). An in-domain email
// (`alice@example.com`) gets a link and lands authenticated; an off-domain email
// (`mallory@evil.test`) is refused behind the neutral confirmation - no mail is
// ever sent (the AUTHOR_EMAIL_DOMAIN rule, checked inside requestAuthorSignIn).

test.beforeEach(async () => {
	await clearMailbox();
});

test('multi mode shows the email form, not the password form', async ({ page }) => {
	await page.goto('/login');

	// The magic-link email field is present; the password field is absent.
	await expect(page.getByLabel('Email')).toBeVisible();
	await expect(page.locator('input[name="password"]')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Send sign-in link' })).toBeVisible();
});

test('an in-domain author signs in via the emailed magic link', async ({ page }) => {
	// A fresh email distinct from the reused authors (owner/alice/bob): this test
	// OWNS a live sign-in to prove the magic-link path, while the reused authors are
	// signed in once in `multi-auth.setup.ts`. Keeping it distinct also keeps the
	// total per-IP author-verification submissions within the burst window.
	const email = 'carol@example.com';

	await page.goto('/login');
	await page.getByLabel('Email').fill(email);
	await page.getByRole('button', { name: 'Send sign-in link' }).click();

	// The form always returns the same neutral confirmation (enumeration-safe).
	await expect(page.getByRole('status')).toContainText('Check your email');

	// Mailpit captured the sign-in link; clicking it opens the workspace. The author
	// row is minted on this first verified sign-in (self-service provisioning).
	const magicLink = await getLatestMagicLink(email);
	await page.goto(magicLink);
	await expect(page).toHaveURL(/\/reports$/);

	// The session is real and carries the author identity: the workspace surfaces
	// the signed-in author's email near logout (story 8.6).
	await expect(page.getByText(email)).toBeVisible();

	// And the session persists across navigation to another guarded route (not
	// bounced to /login).
	await page.goto('/settings');
	await expect(page).toHaveURL(/\/settings$/);
});

test('an off-domain email is refused: no mail, neutral confirmation', async ({ page }) => {
	const offDomain = 'mallory@evil.test';

	await page.goto('/login');
	await page.getByLabel('Email').fill(offDomain);
	await page.getByRole('button', { name: 'Send sign-in link' }).click();

	// Same neutral confirmation as the in-domain path (NFR9): the refusal never
	// reveals the email is not an authorized author.
	await expect(page.getByRole('status')).toContainText('Check your email');

	// But no link is ever issued or mailed for an off-domain address - the domain
	// check inside requestAuthorSignIn short-circuits before any token or send.
	await expectNoMail(offDomain);
});
