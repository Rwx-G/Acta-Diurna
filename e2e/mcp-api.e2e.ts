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
