import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { reports } from '../src/lib/server/db/schema.ts';
import { DB_URL_FILE, E2E_BASE_URL } from './fixtures.ts';

// Authenticated via the `setup` project's storage state. Lean happy path for
// story 2.3 (FR10): create a report, duplicate it from the list, and confirm
// the duplicate opens as a fresh editable draft titled like the source.
//
// The POSTs go through Playwright's request context with an explicit Origin
// header because the APIRequestContext does not set one automatically the way a
// real browser form navigation does; it satisfies SvelteKit's CSRF origin
// check. See e2e/auth.ts for the full note.
async function postForm(
	page: import('@playwright/test').Page,
	url: string,
	form: Record<string, string>
): Promise<{ type?: string; location?: string }> {
	const response = await page.request.post(url, {
		headers: { origin: E2E_BASE_URL, 'content-type': 'application/x-www-form-urlencoded' },
		form,
		maxRedirects: 0,
		failOnStatusCode: false
	});
	return (await response.json()) as { type?: string; location?: string };
}

test('duplicates a report into a fresh editable draft', async ({ page }, testInfo) => {
	// The workspace reports list is desktop-only; the narrow mobile rail clips the
	// per-row action buttons. Run this flow on the desktop project only.
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	// Create a report to duplicate; capture its id from the editor redirect.
	const created = await postForm(page, `${E2E_BASE_URL}/reports/new`, {});
	expect(created.type).toBe('redirect');
	const sourceId = created.location!.match(/^\/reports\/([0-9a-f-]+)\/edit$/)?.[1];
	expect(sourceId).toBeTruthy();

	// Duplicate it from the list action; the action redirects to the new editor.
	const duplicated = await postForm(page, `${E2E_BASE_URL}/reports?/duplicate`, {
		id: sourceId!
	});
	expect(duplicated.type).toBe('redirect');
	expect(duplicated.location).toMatch(/^\/reports\/[0-9a-f-]+\/edit$/);

	// The duplicate is a distinct report, opening as an editable draft.
	const duplicateId = duplicated.location!.match(/^\/reports\/([0-9a-f-]+)\/edit$/)?.[1];
	expect(duplicateId).not.toBe(sourceId);

	await page.goto(duplicated.location!);
	await expect(page.getByText('draft', { exact: true })).toBeVisible();
});

test('a duplicated report carries the series lineage edge (story 9.1)', async ({
	page
}, testInfo) => {
	// Desktop-only like the flow above: the duplicate action is a list-row button.
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const created = await postForm(page, `${E2E_BASE_URL}/reports/new`, {});
	const sourceId = created.location!.match(/^\/reports\/([0-9a-f-]+)\/edit$/)?.[1];
	expect(sourceId).toBeTruthy();

	const duplicated = await postForm(page, `${E2E_BASE_URL}/reports?/duplicate`, { id: sourceId! });
	const duplicateId = duplicated.location!.match(/^\/reports\/([0-9a-f-]+)\/edit$/)?.[1];
	expect(duplicateId).toBeTruthy();

	// Assert the lineage edge against the REAL testcontainer Postgres (the DB seam):
	// the duplicate inherits the source's series and points its predecessor at the
	// source, the source already carries a series (minted on create), and a fresh
	// (never-duplicated) report has a null predecessor.
	const pool = new pg.Pool({ connectionString: readFileSync(DB_URL_FILE, 'utf8').trim() });
	try {
		const db = drizzle(pool);
		const [source] = await db
			.select({ seriesId: reports.seriesId, predecessorId: reports.predecessorId })
			.from(reports)
			.where(eq(reports.id, sourceId!));
		const [copy] = await db
			.select({ seriesId: reports.seriesId, predecessorId: reports.predecessorId })
			.from(reports)
			.where(eq(reports.id, duplicateId!));

		expect(source.seriesId).not.toBeNull();
		expect(source.predecessorId).toBeNull();
		expect(copy.predecessorId).toBe(sourceId);
		expect(copy.seriesId).toBe(source.seriesId);
	} finally {
		await pool.end();
	}
});
