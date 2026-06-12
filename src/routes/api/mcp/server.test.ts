import { describe, expect, it } from 'vitest';
import { POST } from './+server';

const PROTOCOL_VERSION = '2025-06-18';

function mcpRequest(body: unknown): Parameters<typeof POST>[0] {
	const request = new Request('http://localhost/api/mcp', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			// The Streamable HTTP transport requires the client to accept both.
			accept: 'application/json, text/event-stream'
		},
		body: JSON.stringify(body)
	});
	return { request } as unknown as Parameters<typeof POST>[0];
}

/** Reads a single JSON-RPC response whether the transport answered JSON or SSE. */
async function readResult(response: Response): Promise<Record<string, unknown>> {
	const text = await response.text();
	const contentType = response.headers.get('content-type') ?? '';
	if (contentType.includes('text/event-stream')) {
		const dataLine = text.split('\n').find((line) => line.startsWith('data:'));
		return JSON.parse(dataLine!.slice('data:'.length).trim());
	}
	return JSON.parse(text);
}

describe('POST /api/mcp (transport bridge)', () => {
	it('completes the MCP initialize handshake and advertises the acta-diurna server', async () => {
		const response = await POST(
			mcpRequest({
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: PROTOCOL_VERSION,
					capabilities: {},
					clientInfo: { name: 'route-test', version: '0.0.0' }
				}
			})
		);

		expect(response.status).toBe(200);
		const result = await readResult(response);
		const payload = result.result as { serverInfo: { name: string }; capabilities: unknown };
		expect(payload.serverInfo.name).toBe('acta-diurna');
		expect(payload.capabilities).toBeDefined();
	});

	it('does not issue an Mcp-Session-Id (stateless-per-request, the PAT is the session)', async () => {
		const response = await POST(
			mcpRequest({
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: PROTOCOL_VERSION,
					capabilities: {},
					clientInfo: { name: 'route-test', version: '0.0.0' }
				}
			})
		);
		expect(response.headers.get('mcp-session-id')).toBeNull();
	});
});
