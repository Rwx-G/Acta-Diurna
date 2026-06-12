import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/documents/reports', () => ({
	listReports: vi.fn(),
	getReport: vi.fn()
}));

vi.mock('$lib/server/skeletons/skeletons', () => ({
	listSkeletons: vi.fn()
}));

import { getReport, listReports } from '$lib/server/documents/reports';
import { AppError } from '$lib/server/problem';
import { listSkeletons } from '$lib/server/skeletons/skeletons';
import { buildMcpServer, MCP_SERVER_NAME } from './server';

const VALID_REPORT_ID = '01970000-0000-7000-8000-000000000001';

const listReportsMock = vi.mocked(listReports);
const getReportMock = vi.mocked(getReport);
const listSkeletonsMock = vi.mocked(listSkeletons);

const READ_TOOLS = ['get_schema', 'list_skeletons', 'list_reports', 'get_report'];
// 5.2 adds these; 5.1 must register NONE of them (read-only surface).
const WRITE_TOOL_HINTS = [
	'create',
	'update',
	'delete',
	'publish',
	'push',
	'write',
	'set',
	'remove'
];

let client: Client;

beforeEach(async () => {
	vi.clearAllMocks();
	listReportsMock.mockResolvedValue([]);
	listSkeletonsMock.mockResolvedValue([]);

	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const server = buildMcpServer();
	client = new Client({ name: 'test-client', version: '0.0.0' });
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterEach(async () => {
	await client.close();
});

describe('buildMcpServer', () => {
	it('advertises the acta-diurna server identity', () => {
		expect(client.getServerVersion()?.name).toBe(MCP_SERVER_NAME);
	});

	it('registers exactly the four read-only tools and NO write tools', async () => {
		const { tools } = await client.listTools();
		const names = tools.map((t) => t.name).sort();
		expect(names).toEqual([...READ_TOOLS].sort());

		for (const name of names) {
			expect(WRITE_TOOL_HINTS.some((hint) => name.includes(hint))).toBe(false);
			const tool = tools.find((t) => t.name === name)!;
			expect(tool.annotations?.readOnlyHint).toBe(true);
		}
	});

	it('drives get_schema end-to-end through the SDK to { version, schema, examples }', async () => {
		const result = await client.callTool({ name: 'get_schema' });
		const content = result.content as { type: string; text: string }[];
		const body = JSON.parse(content[0].text) as {
			version: number;
			schema: unknown;
			examples: unknown;
		};
		expect(body.version).toBeTypeOf('number');
		expect(body.schema).toBeDefined();
		expect(body.examples).toBeDefined();
		expect(result.isError).toBeFalsy();
	});

	it('list_reports calls the documents service', async () => {
		await client.callTool({ name: 'list_reports' });
		expect(listReportsMock).toHaveBeenCalledOnce();
	});

	it('list_skeletons calls the skeletons service', async () => {
		await client.callTool({ name: 'list_skeletons' });
		expect(listSkeletonsMock).toHaveBeenCalledOnce();
	});

	it('get_report calls getReport(id) with the passed argument', async () => {
		getReportMock.mockResolvedValue({ id: VALID_REPORT_ID } as unknown as Awaited<
			ReturnType<typeof getReport>
		>);
		await client.callTool({ name: 'get_report', arguments: { id: VALID_REPORT_ID } });
		expect(getReportMock).toHaveBeenCalledWith(VALID_REPORT_ID);
	});

	it('rejects a malformed get_report id at the SDK tool boundary (no service call)', async () => {
		// Defense in depth: the z.string().uuid() inputSchema bounces a malformed id
		// before the handler runs, so the documents service is never reached.
		const result = await client.callTool({ name: 'get_report', arguments: { id: 'not-a-uuid' } });
		expect(result.isError).toBe(true);
		expect(getReportMock).not.toHaveBeenCalled();
	});

	it('still reaches the service for a valid-shape unknown id (404 isError tool result)', async () => {
		getReportMock.mockRejectedValue(
			new AppError({ status: 404, title: 'Report not found', type: '/problems/report-not-found' })
		);
		const result = await client.callTool({
			name: 'get_report',
			arguments: { id: VALID_REPORT_ID }
		});
		expect(getReportMock).toHaveBeenCalledWith(VALID_REPORT_ID);
		expect(result.isError).toBe(true);
		const content = result.content as { type: string; text: string }[];
		const problem = JSON.parse(content[0].text) as { status: number; type: string };
		expect(problem.status).toBe(404);
		expect(problem.type).toBe('/problems/report-not-found');
	});
});
