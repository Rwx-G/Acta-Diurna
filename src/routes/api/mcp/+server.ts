import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { RequestHandler } from './$types';
import { buildMcpServer } from '$lib/server/mcp/server';

/**
 * `/api/mcp` (story 5.1, FR31) - the MCP discovery surface over Streamable HTTP,
 * the FOURTH entry surface on the SAME service layer. It sits UNDER `/api/*`, so
 * the existing `apiAuth` hook is the gate: a missing/invalid/revoked/malformed
 * PAT is rejected with the standard 401 `application/problem+json`
 * (`WWW-Authenticate: Bearer`) BEFORE this route ever runs, and reveals nothing
 * beyond authentication failure - no tool list, no schema (the 5.1 AC). `/api/mcp`
 * is deliberately NOT in `isPublicApiPath`: MCP is authenticated, unlike the
 * public `/api/v1/schema`. The per-IP + global rate limiters (4.1) cover the auth
 * attempt with no second limiter. By the time this handler runs,
 * `locals.apiIdentity` is non-null (the hook guarantees it for a non-public API
 * path).
 *
 * INTEGRATION (the 5.1 spike): the SDK's `WebStandardStreamableHTTPServerTransport`
 * speaks Web Standard `Request`/`Response` (designed for Hono/Workers/Deno), which
 * is exactly what SvelteKit hands a `+server.ts` route - so the bridge is a direct
 * `transport.handleRequest(event.request)` with no Node `req`/`res` adapter and no
 * monkey-patching. (The Node-oriented `StreamableHTTPServerTransport`, which the
 * story flagged as the risk, is NOT used; this web-standard transport supersedes it
 * for non-Node hosts.)
 *
 * STATELESS-PER-REQUEST (NFR13): `sessionIdGenerator: undefined` disables MCP
 * session state - the PAT is the credential and the "session", so no
 * `Mcp-Session-Id` store is needed. A fresh `McpServer` + transport is built per
 * request and disposed after; `enableJsonResponse: true` returns a single JSON
 * response rather than holding an SSE stream open (the read tools are
 * request/response, no server-initiated streaming).
 */
export const POST: RequestHandler = async ({ request }) => {
	const server = buildMcpServer();
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true
	});
	await server.connect(transport);
	try {
		return await transport.handleRequest(request);
	} finally {
		await transport.close();
		await server.close();
	}
};
