/**
 * The Acta Diurna MCP server (story 5.1, FR31) - the FOURTH entry surface over
 * the SAME service layer (reader cookie / author cookie / REST PAT / MCP PAT).
 * Read-only in 5.1; the write tools (5.2) register on this same instance and
 * transport.
 *
 * Capabilities are exposed as TOOLS (the most agent-portable MCP primitive): an
 * agent that can call tools can drive the whole surface without resource-template
 * support. Each tool delegates to a thin handler in `./tools.ts` that calls the
 * exact documents/skeletons/schema service - no business logic in the wiring.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
	getReportTool,
	getSchemaTool,
	listReportsTool,
	listSkeletonsTool
} from '$lib/server/mcp/tools';

export const MCP_SERVER_NAME = 'acta-diurna';
export const MCP_SERVER_VERSION = '0.6.0';

/**
 * Builds a fresh `McpServer` with the read-only tool set registered. A new
 * instance per request keeps the stateless-per-request posture (the PAT is the
 * session, no `Mcp-Session-Id` state - NFR13): there is no cross-request server
 * state to share, so construction is cheap and isolation is free.
 */
export function buildMcpServer(): McpServer {
	const server = new McpServer(
		{ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
		{
			instructions:
				'Read-only discovery surface for an Acta Diurna instance. Fetch the document ' +
				'JSON Schema and examples (get_schema), then list skeletons and reports and read ' +
				'a single report to orient before authoring.'
		}
	);

	server.registerTool(
		'get_schema',
		{
			title: 'Get document schema',
			description:
				'Returns the published document JSON Schema for the current version with minimal ' +
				'and full example documents: { version, schema, examples }.',
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
		},
		() => getSchemaTool()
	);

	server.registerTool(
		'list_skeletons',
		{
			title: 'List skeletons',
			description: 'Lists the skeleton library (id, name, updatedAt) for instantiating reports.',
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
		},
		() => listSkeletonsTool()
	);

	server.registerTool(
		'list_reports',
		{
			title: 'List reports',
			description:
				'Lists every report (id, title, status, updatedAt), most recently updated first.',
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
		},
		() => listReportsTool()
	);

	server.registerTool(
		'get_report',
		{
			title: 'Get report',
			description:
				'Returns one full report (draft document, published snapshot, status, timestamps) ' +
				'by id. An unknown id is a not-found error result.',
			inputSchema: { id: z.string().describe('The report id (UUID).') },
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
		},
		({ id }) => getReportTool(id)
	);

	return server;
}
