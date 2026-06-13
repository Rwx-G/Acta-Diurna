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
import type { AuthorScope } from '$lib/server/authors';
import {
	createReportTool,
	deleteReportTool,
	getReportTool,
	getSchemaTool,
	listReportsTool,
	listSkeletonsTool,
	publishReportTool,
	unpublishReportTool,
	updateReportTool
} from '$lib/server/mcp/tools';

// A permissive document shape: the SERVICE's validateDocument is the real
// validator (FR2 parity), so the tool boundary only asserts "a JSON object" and
// lets an invalid document surface as the 422 with errors[] from the service.
const documentArg = z
	.record(z.string(), z.unknown())
	.describe('A report document (validated by the service; see get_schema).');

// A UUID at the tool boundary (defense in depth), like get_report; a valid-but-
// unknown id still reaches the service and surfaces its 404.
const reportIdArg = z.string().uuid().describe('The report id (UUID).');

// An ISO 8601 timestamp the agent last saw; a stale value yields the service 409,
// a malformed value is rejected here (the REST "a typo fails loudly" rule).
const expectedUpdatedAtArg = z
	.string()
	.datetime()
	.describe('Optimistic-concurrency token: the ISO 8601 updatedAt you last saw.');

export const MCP_SERVER_NAME = 'acta-diurna';
export const MCP_SERVER_VERSION = '0.6.0';

/**
 * Builds a fresh `McpServer` with the discovery (read) + authoring (write) tool
 * set registered. A new instance per request keeps the stateless-per-request
 * posture (the PAT is the session, no `Mcp-Session-Id` state - NFR13): there is
 * no cross-request server state to share, so construction is cheap and isolation
 * is free.
 */
export function buildMcpServer(scope: AuthorScope): McpServer {
	const server = new McpServer(
		{ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
		{
			instructions:
				'Authoring surface for an Acta Diurna instance. Fetch the document JSON Schema ' +
				'and examples (get_schema), list skeletons and reports and read a single report ' +
				'to orient, then author with create_report / update_report / publish_report / ' +
				'unpublish_report / delete_report. The same service layer, validation, and ' +
				'problem-details errors apply as the REST API.'
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
		() => listSkeletonsTool(scope)
	);

	server.registerTool(
		'list_reports',
		{
			title: 'List reports',
			description:
				'Lists every report (id, title, status, updatedAt), most recently updated first.',
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
		},
		() => listReportsTool(scope)
	);

	server.registerTool(
		'get_report',
		{
			title: 'Get report',
			description:
				'Returns one full report (draft document, published snapshot, status, timestamps) ' +
				'by id. An unknown id is a not-found error result.',
			// Validated as a UUID at the SDK tool boundary (defense in depth): a
			// malformed id is rejected before the handler runs, mirroring the
			// service's UUID_PATTERN 404 one layer earlier. A valid-but-unknown id
			// still reaches the service and surfaces its 404 as an isError result.
			inputSchema: { id: z.string().uuid().describe('The report id (UUID).') },
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
		},
		({ id }) => getReportTool(id, scope)
	);

	// Write tools (story 5.2): readOnlyHint:false; delete carries destructiveHint.
	// Each delegates to the EXACT service the REST endpoint calls (AR5 parity); the
	// document arg is permissive and the SERVICE validates it (FR2 422 with errors[]).

	server.registerTool(
		'create_report',
		{
			title: 'Create report',
			description:
				'Creates a draft report. With a `document` it instantiates that document; without ' +
				'one it seeds a blank starter with an optional `title`. Returns the created report. ' +
				'An invalid document is a validation error result carrying the actionable errors[].',
			inputSchema: {
				title: z
					.string()
					.optional()
					.describe('Title for the blank starter (ignored if document given).'),
				document: documentArg.optional()
			},
			// Not idempotent: each call mints a new report (a fresh id).
			annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false }
		},
		(input) => createReportTool(input, scope)
	);

	server.registerTool(
		'update_report',
		{
			title: 'Update report',
			description:
				'Updates a draft report by id. Supply `title`, `document`, or both (both -> the title ' +
				'is merged into the document and written atomically under one concurrency guard). ' +
				'Pass `expectedUpdatedAt` (the updatedAt you last saw) to opt into optimistic ' +
				'concurrency: a stale value is a conflict error. An invalid document carries errors[].',
			inputSchema: {
				id: reportIdArg,
				title: z
					.string()
					.optional()
					.describe('New title (wins over document.title when both are present).'),
				document: documentArg.optional(),
				expectedUpdatedAt: expectedUpdatedAtArg.optional()
			},
			// Idempotent given the same inputs and an unchanged report; the guard makes
			// a stale re-apply a conflict rather than a silent overwrite.
			annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false }
		},
		(input) => updateReportTool(input, scope)
	);

	server.registerTool(
		'publish_report',
		{
			title: 'Publish report',
			description:
				'Freezes the draft into the published snapshot. Idempotent on an already-published ' +
				'report. Optional `expectedUpdatedAt` opts into the optimistic-concurrency conflict. ' +
				'An invalid draft is a validation error result carrying the actionable errors[].',
			inputSchema: { id: reportIdArg, expectedUpdatedAt: expectedUpdatedAtArg.optional() },
			annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false }
		},
		(input) => publishReportTool(input, scope)
	);

	server.registerTool(
		'unpublish_report',
		{
			title: 'Unpublish report',
			description:
				'Reverts a published report to an editable draft and clears its snapshot. Idempotent ' +
				'on a draft. Takes no concurrency token (reverting to draft is not a lost-update hazard).',
			inputSchema: { id: reportIdArg },
			annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false }
		},
		({ id }) => unpublishReportTool(id, scope)
	);

	server.registerTool(
		'delete_report',
		{
			title: 'Delete report',
			description:
				'Deletes a draft report by id. A published report refuses with a conflict error ' +
				'(unpublish it first). This is destructive and cannot be undone.',
			inputSchema: { id: reportIdArg },
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
				openWorldHint: false
			}
		},
		({ id }) => deleteReportTool(id, scope)
	);

	return server;
}
