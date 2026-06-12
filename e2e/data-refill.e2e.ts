import { expect, test } from '@playwright/test';
import { E2E_BASE_URL } from './fixtures.ts';

// Story 2.5, UX Flow B "the refill": upload a fresh export onto an already-bound
// report and watch the bindings resolve. The lean happy + recovery path:
//   1. bind a table block to an initial data set (severity + count),
//   2. inject a FRESH matching data set -> auto-rebind, all green (FR14),
//   3. inject a DRIFTED data set (count renamed to counts) -> amber diagnostic
//      naming the closest match (FR15),
//   4. remap the drifted field in place -> green again, the remap persists.
//
// Workspace is desktop-only, so this runs on the desktop project only (the 2.2 /
// 2.4 concession). A FRESH draft report is used so the bind/rebind writes
// succeed (the shared published fixture is read-only). POSTs go through the
// request context with an explicit Origin header (the HTTP-only CSRF concession).

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

test('refill: fresh data rebinds green, a drift diagnoses, a remap recovers', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const headers = { origin: E2E_BASE_URL };
	const formHeaders = { ...headers, 'content-type': 'application/x-www-form-urlencoded' };

	async function uploadCsv(name: string, csv: string): Promise<string> {
		const response = await page.request.post(`${E2E_BASE_URL}/data-sets?/upload`, {
			headers,
			multipart: { file: { name, mimeType: 'text/csv', buffer: Buffer.from(csv) } },
			failOnStatusCode: false
		});
		expect(response.ok()).toBe(true);
		const body = (await response.json()) as { type?: string; data?: string };
		expect(body.type).toBe('success');
		const ids = JSON.parse(body.data ?? '[]') as string[];
		const id = ids.find((entry) => /^[0-9a-f-]{36}$/.test(entry));
		expect(id).toBeTruthy();
		return id!;
	}

	// Fresh draft report with one bindable table block.
	const created = await page.request.post(`${E2E_BASE_URL}/reports/new`, {
		headers: formHeaders,
		form: {},
		maxRedirects: 0,
		failOnStatusCode: false
	});
	const reportId = ((await created.json()) as { location?: string }).location?.match(
		/^\/reports\/([0-9a-f-]+)\/edit$/
	)?.[1];
	expect(reportId).toBeTruthy();

	const save = await page.request.post(`${E2E_BASE_URL}/reports/${reportId}/edit?/save`, {
		headers: formHeaders,
		form: { document: tableDocument(`E2E Refill ${Date.now()}`) }
	});
	expect(((await save.json()) as { type?: string }).type).toBe('success');

	// Initial bind: severity + count, both columns.
	const initialId = await uploadCsv('initial.csv', 'severity,count\nCritical,4\nHigh,9');
	const bind = await page.request.post(`${E2E_BASE_URL}/reports/${reportId}/edit?/bind`, {
		headers: formHeaders,
		form: {
			blockId: 'severity-table',
			dataSetId: initialId,
			slotMapping: JSON.stringify({ severity: { role: 'column' }, count: { role: 'column' } })
		},
		failOnStatusCode: false
	});
	expect(((await bind.json()) as { type?: string }).type).toBe('success');

	// 1. Inject a FRESH matching data set -> auto-rebind, all green (FR14).
	const freshId = await uploadCsv('fresh.csv', 'severity,count\nCritical,7\nMedium,12');
	const rebind = await page.request.post(`${E2E_BASE_URL}/reports/${reportId}/edit?/rebind`, {
		headers: formHeaders,
		form: { dataSetId: freshId },
		failOnStatusCode: false
	});
	const rebindData = JSON.parse(
		((await rebind.json()) as { data?: string }).data ?? '{}'
	) as Record<string, unknown>;
	// The action data is a flattened devalue array; assert the summary's all-green
	// and the rebound block id surfaced somewhere in the payload.
	const rebindText = JSON.stringify(rebindData);
	expect(rebindText).toContain('severity-table');
	expect(rebindText).toContain('allGreen');

	// 2. Inject a DRIFTED data set (count -> counts) -> amber diagnostic (FR15).
	const driftedId = await uploadCsv('drifted.csv', 'severity,counts\nCritical,3\nLow,20');
	const drift = await page.request.post(`${E2E_BASE_URL}/reports/${reportId}/edit?/rebind`, {
		headers: formHeaders,
		form: { dataSetId: driftedId },
		failOnStatusCode: false
	});
	const driftText = JSON.stringify(await drift.json());
	// The diagnostic names the expected field and its closest match.
	expect(driftText).toContain('drifted');
	expect(driftText).toContain('counts');

	// 3. Remap the drifted "count" onto the available "counts" -> green again.
	const remap = await page.request.post(`${E2E_BASE_URL}/reports/${reportId}/edit?/remap`, {
		headers: formHeaders,
		form: {
			blockId: 'severity-table',
			dataSetId: driftedId,
			expectedField: 'count',
			availableField: 'counts'
		},
		failOnStatusCode: false
	});
	expect(((await remap.json()) as { type?: string }).type).toBe('success');

	// The remap persisted: the bound block now carries the "counts" column and the
	// drifted data's rows. The editor renders cells as input VALUES (DOM property).
	await page.goto(`/reports/${reportId}/edit`);
	await expect(page.locator('.editor input').first()).toBeVisible();
	await expect
		.poll(async () =>
			page
				.locator('.editor input')
				.evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value))
		)
		.toEqual(expect.arrayContaining(['Critical', 'Low']));

	// Glance-at-green through the actual UI (UX Flow B, the defining moment). The
	// remap above made the binding expect "counts", so the drifted.csv (severity +
	// counts) is now the matching set: rebind it and see the green chip + the "all
	// green" header summary.
	const refill = page.locator('section[aria-label="Refill data"]');
	await refill.locator('select').selectOption({ label: 'drifted.csv' });
	await refill.getByRole('button', { name: 'Rebind from this data set' }).click();
	// The header summary (a live region) shows "N bindings - all green".
	await expect(refill.locator('p[role="status"][aria-live]').getByText('all green')).toBeVisible();
	await expect(refill.locator('.chips').getByText('Bound')).toBeVisible();

	// Drift through the UI: the original fresh.csv carries "count" (not "counts"),
	// so rebinding it now drifts. The chip turns amber; open it to reveal the
	// diagnostic naming the expected field and its closest match ("count").
	await refill.locator('select').first().selectOption({ label: 'fresh.csv' });
	await refill.getByRole('button', { name: 'Rebind from this data set' }).click();
	const amberChip = refill.locator('.chips').getByRole('button', { name: /Drifted/ });
	await expect(amberChip).toBeVisible();
	await amberChip.click();
	await expect(refill.getByText('closest match')).toBeVisible();
	// The diagnostic proposes the closest match "count" (the expected field that
	// drifted to "counts"); it is highlighted as the closest-match code chip.
	await expect(refill.locator('code.closest')).toHaveText('count');
});
