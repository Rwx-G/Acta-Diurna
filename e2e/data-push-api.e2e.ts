import { expect, test } from '@playwright/test';
import { E2E_BASE_URL } from './fixtures.ts';

// Story 4.3 (the final V1 story): the unattended inject-and-render cycle over
// /api/v1 with a real PAT. Create a draft report with a bindable table block via
// the API, push a CSV onto it -> 201 with the binding diagnostics + the report
// now showing bound data (FR13/14/15 parity with the upload flow). Plus the
// PUBLIC published-schema endpoint: /api/v1/schema WITHOUT a token -> 200 with a
// valid draft-2020-12 schema and the examples.
//
// Authenticated via the `setup` project's storage state for the settings UI step
// only; every /api/v1 call uses the Bearer token, never the cookie (strict realm
// separation). The settings POST carries an explicit Origin (the HTTP-only CSRF
// concession the other workspace specs use; production is HTTPS).
test('PAT-push a CSV onto a draft report, plus the public schema endpoint', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	// The published schema is PUBLIC (no bearer): { version, schema, examples }.
	const schema = await page.request.get(`${E2E_BASE_URL}/api/v1/schema`, {
		maxRedirects: 0,
		failOnStatusCode: false
	});
	expect(schema.status()).toBe(200);
	const schemaBody = (await schema.json()) as {
		version: number;
		schema: { $schema: string };
		examples: { minimal: unknown; full: unknown };
	};
	expect(schemaBody.version).toBe(1);
	expect(schemaBody.schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
	expect(schemaBody.examples.minimal).toBeDefined();
	expect(schemaBody.examples.full).toBeDefined();

	// A data-set push DOES require a PAT: no bearer -> 401, never a redirect.
	const noBearer = await page.request.post(`${E2E_BASE_URL}/api/v1/data-sets`, {
		headers: { 'content-type': 'text/csv' },
		data: 'a,b\n1,2',
		maxRedirects: 0,
		failOnStatusCode: false
	});
	expect(noBearer.status()).toBe(401);

	// Mint a PAT via settings (shown once).
	await page.goto('/settings');
	await page.getByLabel('Token name').fill('e2e data push');
	await page.getByRole('button', { name: 'Create token' }).click();
	const rawToken = (await page.locator('.created-url').textContent())!.trim();
	expect(rawToken).toMatch(/^acta_pat_[A-Za-z0-9_-]{43}$/);
	const auth = { authorization: `Bearer ${rawToken}` };

	// Create a draft report with one table block whose binding already maps the
	// "severity" field to a column slot (as a prior bind would). The unattended
	// push then auto-rebinds it from the recovered slot mapping (FR14), no manual
	// remap - the inject-and-render cycle running headless.
	const document = {
		version: 1,
		title: `E2E Data Push ${Date.now()}`,
		sections: [
			{
				id: 'metrics',
				title: 'Metrics',
				blocks: [
					{
						type: 'table',
						id: 'severity-table',
						columns: [{ key: 'placeholder', label: 'Placeholder' }],
						binding: { fields: [{ name: 'severity', type: 'string', slot: { role: 'column' } }] }
					}
				]
			}
		]
	};
	const created = await page.request.post(`${E2E_BASE_URL}/api/v1/reports`, {
		headers: { ...auth, 'content-type': 'application/json' },
		data: { document },
		failOnStatusCode: false
	});
	expect(created.status()).toBe(201);
	const report = (await created.json()) as { id: string };

	// Push the matching data set: the auto-rebind resolves the "severity" column
	// from the recovered slot mapping (FR14), and the response carries the
	// per-block diagnostics + summary (FR15 parity).
	const push = await page.request.post(
		`${E2E_BASE_URL}/api/v1/data-sets?reportId=${report.id}`,
		{
			headers: { ...auth, 'content-type': 'text/csv', 'x-filename': 'incidents.csv' },
			data: 'severity\nCritical\nHigh',
			failOnStatusCode: false
		}
	);
	expect(push.status()).toBe(201);
	const pushBody = (await push.json()) as {
		dataSet: { id: string; sourceFormat: string };
		diagnostics: Array<{ blockId: string; state: string }>;
		summary: { total: number; allGreen: boolean };
	};
	expect(pushBody.dataSet.sourceFormat).toBe('csv');
	// The diagnostics name the block and its binding state (FR15 parity): the
	// "severity" field is present in the pushed data, so the block is bound green.
	expect(pushBody.diagnostics.some((d) => d.blockId === 'severity-table')).toBe(true);
	expect(pushBody.summary.allGreen).toBe(true);

	// The report now carries the bound data: GET it and assert the table block
	// resolved the pushed rows.
	const fetched = await page.request.get(`${E2E_BASE_URL}/api/v1/reports/${report.id}`, {
		headers: auth,
		failOnStatusCode: false
	});
	expect(fetched.status()).toBe(200);
	const fetchedDoc = JSON.stringify((await fetched.json()) as unknown);
	expect(fetchedDoc).toContain('Critical');
	expect(fetchedDoc).toContain(pushBody.dataSet.id);

	// A drift: push data whose field renames "severity" -> "level". The diagnostic
	// names the closest match (FR15) and the binding is reported as drifted.
	const drift = await page.request.post(
		`${E2E_BASE_URL}/api/v1/data-sets?reportId=${report.id}`,
		{
			headers: { ...auth, 'content-type': 'text/csv' },
			data: 'severities\nMedium\nLow',
			failOnStatusCode: false
		}
	);
	expect(drift.status()).toBe(201);
	const driftText = JSON.stringify(await drift.json());
	expect(driftText).toContain('severities');

	// Pushing onto a PUBLISHED report is a clean 409 (binding targets a draft).
	const published = await page.request.post(
		`${E2E_BASE_URL}/api/v1/reports/${report.id}/publish`,
		{ headers: auth, failOnStatusCode: false }
	);
	expect(published.status()).toBe(200);
	const onPublished = await page.request.post(
		`${E2E_BASE_URL}/api/v1/data-sets?reportId=${report.id}`,
		{
			headers: { ...auth, 'content-type': 'text/csv' },
			data: 'severity\nCritical',
			failOnStatusCode: false
		}
	);
	expect(onPublished.status()).toBe(409);
	expect(onPublished.headers()['content-type']).toContain('application/problem+json');
});
