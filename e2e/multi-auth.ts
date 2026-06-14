import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { clearMailbox, getLatestMagicLink } from './mailpit.ts';

/**
 * The multi-mode app boots with `ADDRESS_HEADER=x-forwarded-for` (see
 * `multi-global-setup.ts`), so the per-IP rate limiters key on the
 * `X-Forwarded-For` header rather than the shared localhost socket address. Every
 * harness context sets a DISTINCT forwarded IP, so each author/reader gets its own
 * per-IP author-verification bucket and a run with several sign-ins never drains a
 * shared burst. This is the adapter-node proxy-address feature used as the
 * harness's per-actor isolation seam - it does NOT weaken the limiter (the
 * IP-independent global brakes still apply); it just stops the test's single
 * egress IP from collapsing every actor into one bucket.
 *
 * The header MUST be present on every app request once `ADDRESS_HEADER` is set
 * (adapter-node throws on a missing header), so contexts are always created through
 * `actorContext`, which sets it, and `multi-global-setup` sends it on the health
 * poll. RFC 5737 TEST-NET-1 (192.0.2.0/24) supplies the distinct, non-routable IPs.
 */
let nextActorOctet = 10;

/** A fresh browser context with a unique forwarded IP (and optional saved session). */
export async function actorContext(
	browser: Browser,
	options: { storageState?: string } = {}
): Promise<BrowserContext> {
	const ip = `192.0.2.${nextActorOctet++}`;
	return browser.newContext({
		...options,
		extraHTTPHeaders: { 'x-forwarded-for': ip }
	});
}

/**
 * Signs a multi-mode author in via the real magic-link flow and leaves `page` on an
 * authenticated workspace session. The mailbox is cleared first so the polled link
 * is unambiguously this author's. The page MUST belong to an `actorContext` (its
 * unique forwarded IP gives it an isolated rate-limit bucket).
 *
 * The email MUST be in `AUTHOR_EMAIL_DOMAIN` (example.com) or no link is issued and
 * this throws on the Mailpit poll timeout - a fast, honest failure, never a silent
 * pass.
 */
export async function signInAsAuthor(page: Page, email: string): Promise<void> {
	await clearMailbox();
	await page.goto('/login');
	await page.getByLabel('Email').fill(email);
	await page.getByRole('button', { name: 'Send sign-in link' }).click();
	await expect(page.getByRole('status')).toContainText('Check your email');

	const magicLink = await getLatestMagicLink(email);
	await page.goto(magicLink);
	await expect(page).toHaveURL(/\/reports$/);
}

/**
 * Mints a personal access token for the author currently signed in on `page` via
 * the settings UI (the raw token is shown once) and returns it. The token carries
 * that author's ownerId (story 8.2), so a REST call bearing it is scoped to the
 * author - the seam the tenancy spec drives create/list/get through.
 */
export async function mintPat(page: Page, name: string): Promise<string> {
	await page.goto('/settings');
	await page.getByLabel('Token name').fill(name);
	await page.getByRole('button', { name: 'Create token' }).click();
	const tokenCode = page.locator('.created-url');
	await expect(tokenCode).toBeVisible();
	const raw = (await tokenCode.textContent())!.trim();
	expect(raw).toMatch(/^acta_pat_[A-Za-z0-9_-]{43}$/);
	return raw;
}
