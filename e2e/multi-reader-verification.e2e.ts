import { expect, test, type Browser } from '@playwright/test';
import { E2E_MULTI_BASE_URL, FIXTURE_REPORT_ID, MULTI_AUTHORS } from './fixtures.ts';
import { clearMailbox, expectNoMail, getLatestMagicLink } from './mailpit.ts';
import { actorContext } from './multi-auth.ts';

// Multi-mode reader verification + destination whitelist (Epic 8, stories 8.4/8.5),
// end to end. In multi mode a share is NOT a bare consultation link: the reader must
// verify by email (a magic link), and READER_EMAIL_DOMAINS gates which reader
// domains may. The single-mode harness serves shares directly (consultation) and
// cannot reach this flow; here it runs for real against Mailpit.
//
// Setup: the seeded published fixture report is owned by INITIAL_OWNER (it inherited
// the null-owner row at boot). The owner signs in by magic link and creates an OPEN
// share on it (open so the per-share recipient list is not the gate - the whitelist
// is). Then:
//   - an in-whitelist reader (`@reader.example.com`) gets a magic link, clicks it,
//     and reads the report (no bare consultation - the verify card gates first);
//   - an off-whitelist reader (`@outsider.test`) is refused behind the same neutral
//     confirmation, with NO mail sent (READER_EMAIL_DOMAINS).

const sharePostUrl = `${E2E_MULTI_BASE_URL}/reports/${FIXTURE_REPORT_ID}/share?/create-share`;

/**
 * Creates an OPEN share on the fixture report as the signed-in owner and returns the
 * `/r/<token>` reader URL. Posts the share-create action through the page's request
 * context with an explicit Origin (the same CSRF concession the single-mode specs
 * use over plain HTTP); `mode=open` makes the whitelist - not a recipient list - the
 * only reader-email gate.
 */
async function createOpenShare(browser: Browser): Promise<string> {
	// The owner inherited the seeded fixture report at boot; restore their saved
	// session (signed in once in multi-auth.setup.ts) rather than signing in again.
	const context = await actorContext(browser, { storageState: MULTI_AUTHORS.owner.state });
	const page = await context.newPage();
	try {
		const response = await page.request.post(sharePostUrl, {
			headers: {
				origin: E2E_MULTI_BASE_URL,
				'content-type': 'application/x-www-form-urlencoded'
			},
			form: { mode: 'open' },
			failOnStatusCode: false
		});
		// A SvelteKit form action over the request API returns its result as JSON.
		const result = (await response.json()) as {
			type?: string;
			data?: string;
		};
		expect(result.type, 'share creation should succeed').toBe('success');
		// The action's `data` is SvelteKit's devalue-encoded form payload; the reader
		// URL is the one `/r/<token>` string in it.
		const shareUrl = result.data?.match(/https?:\/\/[^\s"\\]+\/r\/[A-Za-z0-9_-]{43}/)?.[0];
		expect(shareUrl, 'share URL present in the action result').toBeTruthy();
		return shareUrl!;
	} finally {
		await context.close();
	}
}

test('multi mode gates a share behind reader verification, not a bare consultation link', async ({
	browser
}) => {
	await clearMailbox();
	const shareUrl = await createOpenShare(browser);
	const inWhitelistReader = 'dana@reader.example.com';

	const readerContext = await actorContext(browser);
	const readerPage = await readerContext.newPage();
	try {
		// Opening the share does NOT serve the report directly: the verify card gates
		// it (multi mode), unlike the single-mode consultation path.
		await readerPage.goto(shareUrl);
		await expect(
			readerPage.getByRole('heading', { name: /enter your email to read this report/i })
		).toBeVisible();
		await expect(readerPage.getByRole('application')).toHaveCount(0);

		// An in-whitelist reader submits their email and gets the neutral confirmation.
		await clearMailbox();
		await readerPage.getByRole('textbox', { name: 'Your email' }).fill(inWhitelistReader);
		await readerPage.getByRole('button', { name: 'Send my link' }).click();
		await expect(readerPage.getByRole('heading', { name: /check your email/i })).toBeVisible();

		// Mailpit captured the reader magic link. Visiting it lands on the prefetch-safe
		// interstitial (A1): the GET peeks WITHOUT consuming, so a mail-gateway link
		// scanner that prefetches the link cannot burn the token. The reader confirms
		// with a same-origin POST, which consumes the token, opens the reader session,
		// and serves the report.
		const magicLink = await getLatestMagicLink(inWhitelistReader);
		await readerPage.goto(magicLink);
		await readerPage.getByRole('button', { name: 'Confirm and view report' }).click();
		await expect(readerPage.getByRole('application')).toBeVisible();
	} finally {
		await readerContext.close();
	}
});

test('prefetch-safe: a scanner GET on the reader link does not consume the token; the confirm still works', async ({
	browser
}) => {
	await clearMailbox();
	const shareUrl = await createOpenShare(browser);
	const inWhitelistReader = 'grace@reader.example.com';

	const readerContext = await actorContext(browser);
	const readerPage = await readerContext.newPage();
	try {
		await readerPage.goto(shareUrl);
		await readerPage.getByRole('textbox', { name: 'Your email' }).fill(inWhitelistReader);
		await readerPage.getByRole('button', { name: 'Send my link' }).click();
		await expect(readerPage.getByRole('heading', { name: /check your email/i })).toBeVisible();

		const magicLink = await getLatestMagicLink(inWhitelistReader);

		// Simulate a mail-gateway link scanner GET-prefetching the delivered link. The
		// GET renders the interstitial but must NOT consume the token (the old
		// GET-consume bug would burn it here).
		const prefetch = await readerPage.request.get(magicLink, { failOnStatusCode: false });
		expect(prefetch.status()).toBe(200);

		// The reader then clicks: the token is still live, so the confirm POST consumes
		// it and serves the report. If the prefetch had consumed the token, this would
		// have bounced to the expired state instead.
		await readerPage.goto(magicLink);
		await readerPage.getByRole('button', { name: 'Confirm and view report' }).click();
		await expect(readerPage.getByRole('application')).toBeVisible();
	} finally {
		await readerContext.close();
	}
});

test('the Access=Open form selection creates an open share, not restricted', async ({
	browser
}) => {
	// Reproduces the reported bug: choosing "Open" in the share form's Access selector
	// and clicking Generate. The select drives the create-share `mode`; this asserts
	// the selection actually reaches the action (the multipart body carries it) and
	// the resulting share is open, never falling through to restricted.
	const context = await actorContext(browser, { storageState: MULTI_AUTHORS.owner.state });
	const page = await context.newPage();
	try {
		await page.goto(`${E2E_MULTI_BASE_URL}/reports/${FIXTURE_REPORT_ID}/share`);
		await expect(page.getByLabel('Access')).toBeVisible();
		await page.getByLabel('Access').selectOption('open');

		const postPromise = page.waitForRequest(
			(request) => request.url().includes('/share?/create-share') && request.method() === 'POST'
		);
		await page.getByRole('button', { name: 'Generate link' }).click();
		const post = await postPromise;

		// The selected Access must reach the action as mode=open (the multipart form
		// body carries the select's value), not fall through to the restricted default.
		const body = post.postData() ?? '';
		const modeValue = body.match(/(?:^|&)mode=([^&]+)/)?.[1];
		expect(modeValue, 'the create-share POST carries the selected Open mode').toBe('open');

		// End to end: the freshly created share renders open (its mode chip reads "open"
		// and it offers Switch-to-restricted), never restricted (a recipient editor).
		await expect(page.getByText('Your share link', { exact: false })).toBeVisible();
		await expect(page.locator('.share-list li').filter({ hasText: 'open' }).first()).toContainText(
			'Switch to restricted'
		);
	} finally {
		await context.close();
	}
});

test('an off-whitelist reader email is refused: no mail, neutral confirmation', async ({
	browser
}) => {
	await clearMailbox();
	const shareUrl = await createOpenShare(browser);
	const offWhitelistReader = 'eve@outsider.test';

	const readerContext = await actorContext(browser);
	const readerPage = await readerContext.newPage();
	try {
		await readerPage.goto(shareUrl);
		await expect(
			readerPage.getByRole('heading', { name: /enter your email to read this report/i })
		).toBeVisible();

		await clearMailbox();
		await readerPage.getByRole('textbox', { name: 'Your email' }).fill(offWhitelistReader);
		await readerPage.getByRole('button', { name: 'Send my link' }).click();

		// Same neutral confirmation as an in-whitelist reader (NFR9).
		await expect(readerPage.getByRole('heading', { name: /check your email/i })).toBeVisible();

		// But no link is ever issued or mailed - READER_EMAIL_DOMAINS short-circuits
		// inside requestVerification before any token or send.
		await expectNoMail(offWhitelistReader);
	} finally {
		await readerContext.close();
	}
});
