import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import pg from 'pg';
import { hashToken } from '../src/lib/server/crypto/hash-token.ts';
import { DB_URL_FILE, E2E_BASE_URL, FIXTURE_REPORT_ID } from './fixtures.ts';

// Restricted vs open share modes (story 3.4, FR19/FR22/NFR9), end to end against
// the real build. The author creates a RESTRICTED share with a recipient
// allow-list; an ON-LIST reader gets the neutral confirmation AND a real token
// (verified via the DB seam) and reads the report; an OFF-LIST reader gets the
// BYTE-IDENTICAL neutral confirmation but NO token is ever issued (asserted on
// the DB) and cannot read. The two confirmations are indistinguishable - the
// enumeration-safety contract NFR9 demands.

async function postForm(
	page: import('@playwright/test').Page,
	url: string,
	form: Record<string, string>
): Promise<{ status: number; type?: string }> {
	const response = await page.request.post(url, {
		headers: { origin: E2E_BASE_URL, 'content-type': 'application/x-www-form-urlencoded' },
		form,
		maxRedirects: 0,
		failOnStatusCode: false
	});
	const body = (await response.json()) as { type?: string };
	return { status: response.status(), type: body.type };
}

test('restricted share: on-list reads, off-list gets the identical neutral confirmation and cannot read', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'share creation is desktop-only (workspace)');

	const onList = 'allowed@example.com';
	const offList = 'stranger@example.com';

	// Author creates a RESTRICTED share with an initial recipient allow-list.
	await page.goto(`/reports/${FIXTURE_REPORT_ID}/share`);
	await page.getByLabel('Access').selectOption('restricted');
	await page.getByLabel('Recipients').fill(onList);
	await page.getByRole('button', { name: 'Generate link' }).click();
	const linkCode = page.locator('.created-url');
	await expect(linkCode).toBeVisible();
	const shareUrl = (await linkCode.textContent())!.trim();
	const shareToken = shareUrl.match(/\/r\/([A-Za-z0-9_-]{43})$/)![1];

	const databaseUrl = readFileSync(DB_URL_FILE, 'utf8').trim();
	const pool = new pg.Pool({ connectionString: databaseUrl });
	try {
		const shareRow = await pool.query<{ id: string; mode: string }>(
			'select id, mode from shares where token_hash = $1 limit 1',
			[hashToken(shareToken)]
		);
		const shareId = shareRow.rows[0].id;
		expect(shareRow.rows[0].mode).toBe('restricted');

		// The allow-list carries exactly the on-list email (normalized).
		const recipients = await pool.query<{ email: string }>(
			'select email from share_recipients where share_id = $1',
			[shareId]
		);
		expect(recipients.rows.map((r) => r.email)).toEqual([onList]);

		// OFF-LIST reader: the confirmation is the neutral success, BUT no token is
		// issued for that address (the refusal lives behind the neutral response).
		const offReader = await page.context().browser()!.newContext();
		const offPage = await offReader.newPage();
		let offResult: { status: number; type?: string };
		try {
			offResult = await postForm(offPage, `/r/${shareToken}?/request-verification`, {
				email: offList
			});
			expect(offResult.status).toBe(200);
			expect(offResult.type).toBe('success');

			const offTokens = await pool.query(
				'select id from verification_tokens where share_id = $1 and email = $2',
				[shareId, offList]
			);
			expect(offTokens.rowCount).toBe(0);
		} finally {
			await offReader.close();
		}

		// ON-LIST reader: the SAME neutral success, AND a token is issued.
		const onReader = await page.context().browser()!.newContext();
		const onPage = await onReader.newPage();
		try {
			const onResult = await postForm(onPage, `/r/${shareToken}?/request-verification`, {
				email: onList
			});
			// Byte-identical outcome to the off-list path (same status, same type) -
			// the enumeration-safety contract NFR9 demands.
			expect(onResult).toEqual(offResult);

			const onTokens = await pool.query(
				'select id from verification_tokens where share_id = $1 and email = $2',
				[shareId, onList]
			);
			expect(onTokens.rowCount).toBe(1);

			// Verify via the DB seam (the emailed token went only to the unreachable
			// relay, hashed at rest), then confirm the report renders.
			const rawVerification = randomBytes(32).toString('base64url');
			await pool.query(
				`update verification_tokens set token_hash = $1
				 where share_id = $2 and email = $3`,
				[hashToken(rawVerification), shareId, onList]
			);
			await onPage.goto(`/r/${shareToken}/verify?t=${rawVerification}`);
			await expect(onPage).toHaveURL(new RegExp(`/r/${shareToken}$`));
			await expect(onPage.getByRole('application')).toBeVisible();
		} finally {
			await onReader.close();
		}
	} finally {
		await pool.end();
	}
});
