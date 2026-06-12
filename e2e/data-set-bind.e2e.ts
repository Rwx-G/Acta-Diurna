import { expect, test } from '@playwright/test';
import { E2E_BASE_URL } from './fixtures.ts';

// Authenticated via the `setup` project's storage state. Lean happy path for
// story 2.4: upload a CSV from the Data sets page, see its columns inspected
// with inferred types, then bind it to a table block on a fresh draft report
// and confirm the bound data renders in the editor.
//
// The workspace (data-sets + editor) is desktop-only, so this runs on the
// desktop project only - same concession as the 2.2 skeleton flow. A FRESH
// report is created (not the shared published fixture, which is read-only) so
// the bind write succeeds and the spec stays isolated.
//
// POSTs go through Playwright's request context with an explicit Origin header
// (the HTTP-only CSRF concession the other workspace e2e specs use).

/** A draft document with one bindable table block, posted through ?/save. */
function tableDocument(title: string): string {
	return JSON.stringify({
		version: 1,
		title,
		sections: [
			{
				id: 'metrics',
				title: 'Metrics',
				blocks: [
					{
						type: 'table',
						id: 'severity-table',
						columns: [{ key: 'placeholder', label: 'Placeholder' }],
						binding: { fields: [{ name: 'severity', type: 'string' }] }
					}
				]
			}
		]
	});
}

test('uploads a CSV, inspects it, and binds it to a report block', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const headers = { origin: E2E_BASE_URL };
	const formHeaders = { ...headers, 'content-type': 'application/x-www-form-urlencoded' };

	// Create a fresh draft report and give it a bindable table block via ?/save.
	const created = await page.request.post(`${E2E_BASE_URL}/reports/new`, {
		headers: formHeaders,
		form: {},
		maxRedirects: 0,
		failOnStatusCode: false
	});
	const createdBody = (await created.json()) as { location?: string };
	const reportId = createdBody.location?.match(/^\/reports\/([0-9a-f-]+)\/edit$/)?.[1];
	expect(reportId).toBeTruthy();

	const saveResponse = await page.request.post(`${E2E_BASE_URL}/reports/${reportId}/edit?/save`, {
		headers: formHeaders,
		form: { document: tableDocument(`E2E Bind ${Date.now()}`) }
	});
	expect(((await saveResponse.json()) as { type?: string }).type).toBe('success');

	// Upload a CSV through the data-sets upload action (multipart). The columns
	// are severity (string) and count (number) - the inspector infers the types.
	const csv = 'severity,count\nCritical,4\nHigh,9\nMedium,15';
	const uploadResponse = await page.request.post(`${E2E_BASE_URL}/data-sets?/upload`, {
		headers,
		multipart: {
			file: { name: 'severity.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }
		},
		failOnStatusCode: false
	});
	expect(uploadResponse.ok()).toBe(true);
	const uploadBody = (await uploadResponse.json()) as { type?: string; data?: string };
	expect(uploadBody.type).toBe('success');

	// The data-sets page lists the upload with its inferred field types.
	await page.goto('/data-sets');
	const card = page.locator('.card', { hasText: 'severity.csv' });
	await expect(card).toBeVisible();
	await expect(card.getByText('severity', { exact: true })).toBeVisible();
	await expect(card.locator('tr', { hasText: 'count' }).getByText('number')).toBeVisible();

	// Resolve the uploaded data set's id from the upload action data, then bind it
	// to the report's table block, mapping both columns.
	const uploaded = JSON.parse(uploadBody.data ?? '[]') as string[];
	const dataSetId = uploaded.find((entry) => /^[0-9a-f-]{36}$/.test(entry));
	expect(dataSetId).toBeTruthy();

	const slotMapping = JSON.stringify({
		severity: { role: 'column' },
		count: { role: 'column' }
	});
	const bindResponse = await page.request.post(`${E2E_BASE_URL}/reports/${reportId}/edit?/bind`, {
		headers: formHeaders,
		form: { blockId: 'severity-table', dataSetId: dataSetId!, slotMapping },
		failOnStatusCode: false
	});
	expect(bindResponse.ok()).toBe(true);
	expect(((await bindResponse.json()) as { type?: string }).type).toBe('success');

	// The bound table now carries the uploaded rows; the editor renders each cell
	// as an input, so the bound values surface as input VALUES (a DOM property,
	// not an HTML attribute). Read them all and assert the uploaded rows landed.
	await page.goto(`/reports/${reportId}/edit`);
	await expect(page.locator('.editor input').first()).toBeVisible();
	await expect
		.poll(async () =>
			page
				.locator('.editor input')
				.evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value))
		)
		.toEqual(expect.arrayContaining(['Critical', 'Medium']));
});
