import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test } from '@playwright/test';
import { E2E_BASE_URL } from './fixtures.ts';

// Story 5.1 (FR31): the MCP discovery surface is PAT-authenticated over Streamable
// HTTP at /api/mcp. This drives the route with raw JSON-RPC (a full MCP client in
// e2e is impractical and unnecessary - the unit tests drive the SDK client):
// - no PAT -> the 4.1 401 problem+json, the handshake fails revealing nothing;
// - a valid PAT -> the initialize handshake succeeds (200), the server identifies
//   as acta-diurna;
// - a revoked PAT -> 401 again.
const MCP_URL = `${E2E_BASE_URL}/api/mcp`;
const PROTOCOL_VERSION = '2025-06-18';

const initializeEnvelope = {
	jsonrpc: '2.0',
	id: 1,
	method: 'initialize',
	params: {
		protocolVersion: PROTOCOL_VERSION,
		capabilities: {},
		clientInfo: { name: 'e2e', version: '0.0.0' }
	}
};

const MCP_HEADERS = {
	'content-type': 'application/json',
	accept: 'application/json, text/event-stream'
};

test('MCP handshake requires a PAT and identifies as acta-diurna', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	// No bearer -> 401 problem+json, the handshake fails before any MCP envelope is
	// processed (no tool list, no schema, nothing beyond authentication failure).
	const noBearer = await page.request.post(MCP_URL, {
		headers: MCP_HEADERS,
		data: initializeEnvelope,
		maxRedirects: 0,
		failOnStatusCode: false
	});
	expect(noBearer.status()).toBe(401);
	expect(noBearer.headers()['content-type']).toContain('application/problem+json');
	expect(noBearer.headers()['www-authenticate']).toContain('Bearer');
	const problem = (await noBearer.json()) as Record<string, unknown>;
	expect(problem).not.toHaveProperty('result');
	expect(problem).not.toHaveProperty('serverInfo');

	// Mint a PAT via the settings UI (shown once).
	await page.goto('/settings');
	await page.getByLabel('Token name').fill('e2e mcp');
	await page.getByRole('button', { name: 'Create token' }).click();
	const tokenCode = page.locator('.created-url');
	await expect(tokenCode).toBeVisible();
	const rawToken = (await tokenCode.textContent())!.trim();

	// A valid PAT -> the initialize handshake completes; the server is acta-diurna.
	const authed = await page.request.post(MCP_URL, {
		headers: { ...MCP_HEADERS, authorization: `Bearer ${rawToken}` },
		data: initializeEnvelope,
		maxRedirects: 0,
		failOnStatusCode: false
	});
	expect(authed.status()).toBe(200);
	const text = await authed.text();
	const contentType = authed.headers()['content-type'] ?? '';
	const result = contentType.includes('text/event-stream')
		? JSON.parse(
				text
					.split('\n')
					.find((line) => line.startsWith('data:'))!
					.slice(5)
					.trim()
			)
		: JSON.parse(text);
	expect(result.result.serverInfo.name).toBe('acta-diurna');

	// Revoke THIS token (the suite may have minted others, so scope to the row that
	// carries the "e2e mcp" name), then the handshake fails with 401 again.
	const tokenRow = page.locator('.token-list li').filter({ hasText: 'e2e mcp' });
	await tokenRow.getByRole('button', { name: 'Revoke' }).click();
	await tokenRow.getByRole('button', { name: 'Confirm revoke?' }).click();
	await expect(tokenRow.getByText('revoked')).toBeVisible();

	const afterRevoke = await page.request.post(MCP_URL, {
		headers: { ...MCP_HEADERS, authorization: `Bearer ${rawToken}` },
		data: initializeEnvelope,
		maxRedirects: 0,
		failOnStatusCode: false
	});
	expect(afterRevoke.status()).toBe(401);
});

// Story 5.2 (FR31 authoring): drive the write tools end-to-end with a REAL MCP
// client (the SDK's Client over the Streamable HTTP transport, PAT-authenticated)
// against the live server, so the full authoring lifecycle round-trips through the
// real service + DB - not a mock: create_report -> get_report shows it ->
// update_report -> publish_report -> delete_report, plus a bad-document write
// returning the FR2 actionable errors[] (the same payload REST returns).
test('MCP write tools author a report end-to-end with a real PAT', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	// Mint a PAT via the settings UI (shown once).
	await page.goto('/settings');
	await page.getByLabel('Token name').fill('e2e mcp write');
	await page.getByRole('button', { name: 'Create token' }).click();
	const tokenCode = page.locator('.created-url');
	await expect(tokenCode).toBeVisible();
	const rawToken = (await tokenCode.textContent())!.trim();

	const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
		requestInit: { headers: { authorization: `Bearer ${rawToken}` } }
	});
	const client = new Client({ name: 'e2e-write', version: '0.0.0' });
	await client.connect(transport);

	const parse = (result: Awaited<ReturnType<typeof client.callTool>>) => {
		const content = result.content as { type: string; text: string }[];
		return JSON.parse(content[0].text) as Record<string, unknown>;
	};

	try {
		// create_report (blank starter) -> a fresh draft with an id.
		const created = await client.callTool({
			name: 'create_report',
			arguments: { title: 'MCP authored' }
		});
		expect(created.isError).toBeFalsy();
		const report = parse(created);
		const id = report.id as string;
		expect(id).toMatch(/^[0-9a-f-]{36}$/);
		expect(report.status).toBe('draft');

		// get_report shows the just-created report (the round-trip through the DB).
		const fetched = await client.callTool({ name: 'get_report', arguments: { id } });
		expect((parse(fetched) as { id: string }).id).toBe(id);

		// update_report (title only) renames the draft.
		const renamed = await client.callTool({
			name: 'update_report',
			arguments: { id, title: 'MCP renamed' }
		});
		expect((parse(renamed) as { title: string }).title).toBe('MCP renamed');

		// publish_report freezes the snapshot.
		const published = await client.callTool({ name: 'publish_report', arguments: { id } });
		expect((parse(published) as { status: string }).status).toBe('published');

		// delete_report on a published report is the service 409 (no silent skip).
		const deletePublished = await client.callTool({ name: 'delete_report', arguments: { id } });
		expect(deletePublished.isError).toBe(true);
		expect((parse(deletePublished) as { status: number }).status).toBe(409);

		// unpublish_report reverts to draft, then delete_report succeeds.
		await client.callTool({ name: 'unpublish_report', arguments: { id } });
		const deleted = await client.callTool({ name: 'delete_report', arguments: { id } });
		expect(deleted.isError).toBeFalsy();
		expect(parse(deleted)).toEqual({ id, deleted: true });

		// A bad document returns the FR2 actionable errors[] (the REST parity payload).
		const invalid = await client.callTool({
			name: 'create_report',
			arguments: { document: { version: 1 } }
		});
		expect(invalid.isError).toBe(true);
		const problem = parse(invalid) as { status: number; errors: { path: string }[] };
		expect(problem.status).toBe(422);
		expect(Array.isArray(problem.errors)).toBe(true);
		expect(problem.errors.length).toBeGreaterThan(0);
	} finally {
		await transport.close();
	}
});

// Story 11.5 (FR30/FR31 parity): authoring a detail section (`kind: 'detail'`) plus
// an internal `linkTo` over MCP goes through the SAME validate-on-write service REST
// and the workspace use. Drive create_report with a REAL MCP client and assert the
// same three outcomes the REST twin (`reports-api.e2e.ts`) asserts: a valid detail +
// linkTo creates; a dangling linkTo is the cross-ref 422 with the same actionable
// errors[]; an annex + detail section is the mutual-exclusion 422.
test('MCP authors a detail section + linkTo through the shared validate-on-write service', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	await page.goto('/settings');
	await page.getByLabel('Token name').fill('e2e mcp detail');
	await page.getByRole('button', { name: 'Create token' }).click();
	const tokenCode = page.locator('.created-url');
	await expect(tokenCode).toBeVisible();
	const rawToken = (await tokenCode.textContent())!.trim();

	const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
		requestInit: { headers: { authorization: `Bearer ${rawToken}` } }
	});
	const client = new Client({ name: 'e2e-detail', version: '0.0.0' });
	await client.connect(transport);

	const parse = (result: Awaited<ReturnType<typeof client.callTool>>) => {
		const content = result.content as { type: string; text: string }[];
		return JSON.parse(content[0].text) as Record<string, unknown>;
	};

	try {
		// A valid detail section reached by a table rowLink -> accepted, a fresh draft.
		const valid = await client.callTool({
			name: 'create_report',
			arguments: {
				document: {
					version: 1,
					title: 'MCP drill-down',
					sections: [
						{
							id: 'findings',
							title: 'Findings',
							blocks: [
								{
									type: 'table',
									id: 'rows',
									columns: [{ key: 'name', label: 'Name' }],
									rows: [{ name: 'Row A' }],
									rowLinks: ['finding-detail']
								}
							]
						},
						{
							id: 'finding-detail',
							title: 'Finding detail',
							kind: 'detail',
							blocks: [{ type: 'text', id: 'body', paragraphs: [[{ text: 'Evidence.' }]] }]
						}
					]
				}
			}
		});
		expect(valid.isError).toBeFalsy();
		const id = (parse(valid) as { id: string }).id;
		// Clean up the accepted draft.
		await client.callTool({ name: 'delete_report', arguments: { id } });

		// A dangling linkTo -> the cross-reference 422 with the actionable errors[]
		// (the same payload REST returns: path names `linkTo`, message names the target).
		const dangling = await client.callTool({
			name: 'create_report',
			arguments: {
				document: {
					version: 1,
					title: 'MCP dangling',
					sections: [
						{
							id: 'findings',
							title: 'Findings',
							blocks: [
								{
									type: 'text',
									id: 'intro',
									paragraphs: [[{ text: 'See ' }, { text: 'the detail', linkTo: 'ghost-section' }]]
								}
							]
						}
					]
				}
			}
		});
		expect(dangling.isError).toBe(true);
		const danglingProblem = parse(dangling) as {
			status: number;
			errors: { path: string; message: string }[];
		};
		expect(danglingProblem.status).toBe(422);
		expect(danglingProblem.errors.some((error) => error.path.includes('linkTo'))).toBe(true);
		expect(danglingProblem.errors.some((error) => error.message.includes('ghost-section'))).toBe(
			true
		);

		// An annex + detail section -> the mutual-exclusion 422.
		const bothPlacements = await client.callTool({
			name: 'create_report',
			arguments: {
				document: {
					version: 1,
					title: 'MCP both placements',
					sections: [
						{
							id: 'finding-detail',
							title: 'Finding detail',
							kind: 'detail',
							annex: true,
							blocks: [{ type: 'text', id: 'body', paragraphs: [[{ text: 'Evidence.' }]] }]
						}
					]
				}
			}
		});
		expect(bothPlacements.isError).toBe(true);
		const bothProblem = parse(bothPlacements) as {
			status: number;
			errors: { message: string }[];
		};
		expect(bothProblem.status).toBe(422);
		expect(bothProblem.errors.some((error) => error.message.includes('mutually exclusive'))).toBe(
			true
		);
	} finally {
		await transport.close();
	}
});

// The data-push follow-up (the FR13/14/15 parity of POST /api/v1/data-sets as an
// MCP tool): drive push_data_set end-to-end with a REAL MCP client against the live
// server + DB. Create a draft report carrying a table block whose binding maps a
// "severity" column, push the matching CSV over the tool, and assert the data set
// is created, the block rebinds green (diagnostics + summary), and get_report shows
// the bound rows. PAT-gated like every other tool.
test('MCP push_data_set ingests and auto-rebinds a report with a real PAT', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	// Mint a PAT via the settings UI (shown once).
	await page.goto('/settings');
	await page.getByLabel('Token name').fill('e2e mcp push');
	await page.getByRole('button', { name: 'Create token' }).click();
	const tokenCode = page.locator('.created-url');
	await expect(tokenCode).toBeVisible();
	const rawToken = (await tokenCode.textContent())!.trim();

	const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
		requestInit: { headers: { authorization: `Bearer ${rawToken}` } }
	});
	const client = new Client({ name: 'e2e-push', version: '0.0.0' });
	await client.connect(transport);

	const parse = (result: Awaited<ReturnType<typeof client.callTool>>) => {
		const content = result.content as { type: string; text: string }[];
		return JSON.parse(content[0].text) as Record<string, unknown>;
	};

	try {
		// push_data_set is registered and discoverable as a write tool.
		const { tools } = await client.listTools();
		const pushTool = tools.find((t) => t.name === 'push_data_set');
		expect(pushTool).toBeDefined();
		expect(pushTool!.annotations?.readOnlyHint).toBe(false);

		// Create a draft report with one table block whose binding already maps the
		// "severity" field to a column slot, so the push auto-rebinds it (FR14).
		const created = await client.callTool({
			name: 'create_report',
			arguments: {
				document: {
					version: 1,
					title: `MCP Data Push ${Date.now()}`,
					sections: [
						{
							id: 'metrics',
							title: 'Metrics',
							blocks: [
								{
									type: 'table',
									id: 'severity-table',
									columns: [{ key: 'placeholder', label: 'Placeholder' }],
									binding: {
										fields: [{ name: 'severity', type: 'string', slot: { role: 'column' } }]
									}
								}
							]
						}
					]
				}
			}
		});
		expect(created.isError).toBeFalsy();
		const id = (parse(created) as { id: string }).id;

		// Push the matching CSV over the tool: the auto-rebind resolves the "severity"
		// column and the result carries the per-block diagnostics + summary (FR15).
		const pushed = await client.callTool({
			name: 'push_data_set',
			arguments: { content: 'severity\nCritical\nHigh', format: 'csv', reportId: id }
		});
		expect(pushed.isError).toBeFalsy();
		const pushBody = parse(pushed) as {
			dataSet: { id: string; sourceFormat: string };
			diagnostics: { blockId: string; state: string }[];
			summary: { total: number; allGreen: boolean };
		};
		expect(pushBody.dataSet.sourceFormat).toBe('csv');
		expect(pushBody.diagnostics.some((d) => d.blockId === 'severity-table')).toBe(true);
		expect(pushBody.summary.allGreen).toBe(true);

		// get_report shows the report now carrying the bound pushed rows.
		const fetched = await client.callTool({ name: 'get_report', arguments: { id } });
		const fetchedText = JSON.stringify(parse(fetched));
		expect(fetchedText).toContain('Critical');
		expect(fetchedText).toContain(pushBody.dataSet.id);

		// Pushing onto a PUBLISHED report is a clean 409 (binding targets a draft).
		await client.callTool({ name: 'publish_report', arguments: { id } });
		const onPublished = await client.callTool({
			name: 'push_data_set',
			arguments: { content: 'severity\nCritical', format: 'csv', reportId: id }
		});
		expect(onPublished.isError).toBe(true);
		expect((parse(onPublished) as { status: number }).status).toBe(409);
	} finally {
		await transport.close();
	}
});
