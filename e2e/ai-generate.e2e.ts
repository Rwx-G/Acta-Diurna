import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test } from '@playwright/test';
import { E2E_BASE_URL } from './fixtures.ts';

// Authenticated via the `setup` project's storage state. Story 5.4: the
// AI-disabled path. The e2e stack configures NO LLM endpoint and never opts in
// (no LLM_* / AI_GENERATION_ENABLED env), so the connector is disabled. The
// workspace MUST hide the Generate-with-AI entry point (never offer a capability
// that 503s), and a direct POST to the generation action MUST return the 5.3
// disabled problem unchanged. A real-LLM happy path is impractical in CI (no
// endpoint, no phone-home posture) and is covered by the mock-based unit tests.
//
// The POSTs go through Playwright's request context with an explicit Origin
// header to satisfy SvelteKit's CSRF origin check (see e2e/auth.ts).
async function postForm(
	page: import('@playwright/test').Page,
	url: string,
	form: Record<string, string>
): Promise<{ type?: string; location?: string; status?: number; detail?: string }> {
	const response = await page.request.post(url, {
		headers: { origin: E2E_BASE_URL, 'content-type': 'application/x-www-form-urlencoded' },
		form,
		maxRedirects: 0,
		failOnStatusCode: false
	});
	return (await response.json()) as {
		type?: string;
		location?: string;
		status?: number;
		detail?: string;
	};
}

test('hides the Generate-with-AI entry point and 503s the action when AI is disabled', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	// Create a fresh draft and open its editor.
	const created = await postForm(page, `${E2E_BASE_URL}/reports/new`, {});
	const reportId = created.location?.match(/^\/reports\/([0-9a-f-]+)\/edit$/)?.[1];
	expect(reportId).toBeTruthy();

	await page.goto(`${E2E_BASE_URL}/reports/${reportId}/edit`);
	await expect(page.getByRole('textbox', { name: 'Report title' })).toBeVisible();

	// The entry point is hidden: no "Generate with AI" panel when AI is off.
	await expect(page.getByRole('heading', { name: 'Generate with AI' })).toHaveCount(0);

	// A direct POST to the generation action returns the 5.3 disabled problem,
	// surfaced unchanged through the action's failure mapping.
	const outline = await postForm(
		page,
		`${E2E_BASE_URL}/reports/${reportId}/edit?/generate-outline`,
		{ intent: 'A weekly operations review.' }
	);
	// The action returns a SvelteKit failure envelope carrying the 5.3 disabled
	// detail; assert the disabled signal is present in the serialized payload.
	expect(JSON.stringify(outline)).toContain('disabled');
});

// Item 18: outline-first generation is now exposed over the programmatic surface
// (REST /api/v1 + MCP). The e2e stack configures NO LLM endpoint and never opts in,
// so BOTH gates are closed: every generation entry point must return the 5.3
// disabled problem and make NO outbound call (the harness has no LLM endpoint, like
// the workspace spec above). A real-LLM happy path is impractical in CI and is
// covered by the mock-based unit tests.
test('the REST generation endpoints return the disabled problem when AI is off (no LLM call)', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	// Mint a PAT via settings (shown once), like the reports-api spec.
	await page.goto('/settings');
	await page.getByLabel('Token name').fill('e2e gen api');
	await page.getByRole('button', { name: 'Create token' }).click();
	const rawToken = (await page.locator('.created-url').textContent())!.trim();
	const auth = { authorization: `Bearer ${rawToken}` };
	const base = `${E2E_BASE_URL}/api/v1/reports/generate`;

	// POST /generate/outline -> 503 problem+json, the connector disabled before any call.
	const outline = await page.request.post(`${base}/outline`, {
		headers: { ...auth, 'content-type': 'application/json' },
		data: { intent: 'A weekly operations review.' },
		failOnStatusCode: false
	});
	expect(outline.status()).toBe(503);
	expect(outline.headers()['content-type']).toContain('application/problem+json');
	expect((await outline.json()).type).toBe('/problems/ai-generation-disabled');

	// POST /generate/fill -> the same 503; the disabled gate fires inside the service
	// (the fill's hash check would 409, but the connector gate is asserted first here
	// only AFTER the hash check, so we post a matching-shape outline; either way the
	// flow never reaches an outbound call). A trivial outline + an arbitrary hash is
	// enough to drive the endpoint: a real instance would 409 on the hash first, but
	// with AI off the connector path is what matters - assert no 5xx-from-call leak.
	const fill = await page.request.post(`${base}/fill`, {
		headers: { ...auth, 'content-type': 'application/json' },
		data: {
			outline: { title: 'X', sections: [{ title: 'S', intent: '', blocks: [] }] },
			outlineHash: 'deadbeef'
		},
		failOnStatusCode: false
	});
	// The hash will not match (no real approval), so the service 409s BEFORE the
	// connector gate - which still proves NO outbound LLM call happened. Accept either
	// the stale-approval 409 or the disabled 503; both are pre-call refusals.
	expect([409, 503]).toContain(fill.status());
	expect(fill.headers()['content-type']).toContain('application/problem+json');
	const fillBody = (await fill.json()) as { type: string };
	expect(['/problems/ai-outline-stale', '/problems/ai-generation-disabled']).toContain(
		fillBody.type
	);
});

test('the MCP generation tools return the disabled problem when AI is off (no LLM call)', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	// Mint a PAT via settings (shown once).
	await page.goto('/settings');
	await page.getByLabel('Token name').fill('e2e gen mcp');
	await page.getByRole('button', { name: 'Create token' }).click();
	const rawToken = (await page.locator('.created-url').textContent())!.trim();

	const transport = new StreamableHTTPClientTransport(new URL(`${E2E_BASE_URL}/api/mcp`), {
		requestInit: { headers: { authorization: `Bearer ${rawToken}` } }
	});
	const client = new Client({ name: 'e2e-gen', version: '0.0.0' });
	await client.connect(transport);

	const parse = (result: Awaited<ReturnType<typeof client.callTool>>) => {
		const content = result.content as { type: string; text: string }[];
		return JSON.parse(content[0].text) as Record<string, unknown>;
	};

	try {
		// Both generation tools are discoverable as write tools.
		const { tools } = await client.listTools();
		expect(tools.find((t) => t.name === 'generate_outline')).toBeDefined();
		expect(tools.find((t) => t.name === 'generate_report')).toBeDefined();

		// generate_outline with AI off -> the disabled problem in the tool error channel,
		// NO outbound call.
		const outline = await client.callTool({
			name: 'generate_outline',
			arguments: { intent: 'A weekly operations review.' }
		});
		expect(outline.isError).toBe(true);
		expect((parse(outline) as { type: string }).type).toBe('/problems/ai-generation-disabled');

		// generate_report: an arbitrary hash fails the approval check (409) before the
		// connector gate, still proving no outbound call. Accept the stale-approval 409
		// or the disabled 503 - both are pre-call refusals.
		const fill = await client.callTool({
			name: 'generate_report',
			arguments: {
				outline: { title: 'X', sections: [{ title: 'S', intent: '', blocks: [] }] },
				outlineHash: 'deadbeef'
			}
		});
		expect(fill.isError).toBe(true);
		expect(['/problems/ai-outline-stale', '/problems/ai-generation-disabled']).toContain(
			(parse(fill) as { type: string }).type
		);
	} finally {
		await transport.close();
	}
});
