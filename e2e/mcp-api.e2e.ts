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
