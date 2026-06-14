import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/documents/reports', () => ({
	listReports: vi.fn(),
	getReport: vi.fn(),
	createReport: vi.fn(),
	createReportWithDocument: vi.fn(),
	updateReportDocument: vi.fn(),
	updateReportTitle: vi.fn(),
	publishReport: vi.fn(),
	unpublishToDraft: vi.fn(),
	deleteDraft: vi.fn()
}));

vi.mock('$lib/server/skeletons/skeletons', () => ({
	listSkeletons: vi.fn()
}));

vi.mock('$lib/server/ingestion', () => ({
	ingestBytes: vi.fn(),
	rebindReport: vi.fn()
}));

vi.mock('$lib/server/mode', () => ({
	operatingMode: () => 'single',
	isMultiAuthor: () => false
}));

const TEST_SCOPE = { authorId: '01970000-0000-7000-8000-0000000000aa' };

import {
	createReport,
	createReportWithDocument,
	deleteDraft,
	getReport,
	listReports,
	publishReport,
	unpublishToDraft,
	updateReportDocument,
	updateReportTitle,
	type Report
} from '$lib/server/documents/reports';
import { AppError } from '$lib/server/problem';
import { listSkeletons } from '$lib/server/skeletons/skeletons';
import { ingestBytes, rebindReport, type DataSet } from '$lib/server/ingestion';
import { buildMcpServer, MCP_SERVER_NAME } from './server';

const VALID_REPORT_ID = '01970000-0000-7000-8000-000000000001';

const listReportsMock = vi.mocked(listReports);
const getReportMock = vi.mocked(getReport);
const listSkeletonsMock = vi.mocked(listSkeletons);
const createReportMock = vi.mocked(createReport);
const createReportWithDocumentMock = vi.mocked(createReportWithDocument);
const updateReportDocumentMock = vi.mocked(updateReportDocument);
const updateReportTitleMock = vi.mocked(updateReportTitle);
const publishReportMock = vi.mocked(publishReport);
const unpublishToDraftMock = vi.mocked(unpublishToDraft);
const deleteDraftMock = vi.mocked(deleteDraft);
const ingestBytesMock = vi.mocked(ingestBytes);
const rebindReportMock = vi.mocked(rebindReport);

const REPORT = { id: VALID_REPORT_ID, title: 'Q2', status: 'draft' } as Report;

const READ_TOOLS = ['get_schema', 'list_skeletons', 'list_reports', 'get_report'];
// Story 5.2 + the data-push follow-up: the authoring (write) tools registered on
// the same server.
const WRITE_TOOLS = [
	'create_report',
	'update_report',
	'publish_report',
	'unpublish_report',
	'delete_report',
	'push_data_set'
];

let client: Client;

beforeEach(async () => {
	vi.clearAllMocks();
	listReportsMock.mockResolvedValue([]);
	listSkeletonsMock.mockResolvedValue([]);

	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const server = buildMcpServer(TEST_SCOPE);
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

	it('registers exactly the read tools plus the 5.2 write tools', async () => {
		const { tools } = await client.listTools();
		const names = tools.map((t) => t.name).sort();
		expect(names).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
	});

	it('marks the read tools readOnlyHint:true and the write tools readOnlyHint:false', async () => {
		const { tools } = await client.listTools();

		for (const name of READ_TOOLS) {
			expect(tools.find((t) => t.name === name)!.annotations?.readOnlyHint).toBe(true);
		}
		for (const name of WRITE_TOOLS) {
			expect(tools.find((t) => t.name === name)!.annotations?.readOnlyHint).toBe(false);
		}
	});

	it('marks delete_report destructive (and the others not)', async () => {
		const { tools } = await client.listTools();
		expect(tools.find((t) => t.name === 'delete_report')!.annotations?.destructiveHint).toBe(true);
		for (const name of ['create_report', 'update_report', 'publish_report', 'unpublish_report']) {
			expect(tools.find((t) => t.name === name)!.annotations?.destructiveHint).toBeFalsy();
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
		expect(getReportMock).toHaveBeenCalledWith(VALID_REPORT_ID, TEST_SCOPE);
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
		expect(getReportMock).toHaveBeenCalledWith(VALID_REPORT_ID, TEST_SCOPE);
		expect(result.isError).toBe(true);
		const content = result.content as { type: string; text: string }[];
		const problem = JSON.parse(content[0].text) as { status: number; type: string };
		expect(problem.status).toBe(404);
		expect(problem.type).toBe('/problems/report-not-found');
	});

	it('create_report delegates through the SDK to createReport(title)', async () => {
		createReportMock.mockResolvedValue(REPORT);
		const result = await client.callTool({ name: 'create_report', arguments: { title: 'New' } });
		expect(createReportMock).toHaveBeenCalledExactlyOnceWith('New', TEST_SCOPE);
		expect(result.isError).toBeFalsy();
	});

	it('update_report with title+document does ONE guarded write merging the title', async () => {
		updateReportDocumentMock.mockResolvedValue(REPORT);
		await client.callTool({
			name: 'update_report',
			arguments: {
				id: VALID_REPORT_ID,
				document: { version: 1, title: 'From doc', sections: [] },
				title: 'Final'
			}
		});
		expect(updateReportDocumentMock).toHaveBeenCalledExactlyOnceWith(
			VALID_REPORT_ID,
			{ version: 1, title: 'Final', sections: [] },
			TEST_SCOPE,
			undefined
		);
		expect(updateReportTitleMock).not.toHaveBeenCalled();
	});

	it('publish_report and unpublish_report delegate to their services', async () => {
		publishReportMock.mockResolvedValue({ ...REPORT, status: 'published' });
		unpublishToDraftMock.mockResolvedValue(REPORT);

		await client.callTool({ name: 'publish_report', arguments: { id: VALID_REPORT_ID } });
		await client.callTool({ name: 'unpublish_report', arguments: { id: VALID_REPORT_ID } });

		expect(publishReportMock).toHaveBeenCalledExactlyOnceWith(
			VALID_REPORT_ID,
			TEST_SCOPE,
			undefined
		);
		expect(unpublishToDraftMock).toHaveBeenCalledExactlyOnceWith(VALID_REPORT_ID, TEST_SCOPE);
	});

	it('delete_report deletes a draft and 409s on a published report (no silent skip)', async () => {
		deleteDraftMock.mockResolvedValue();
		const ok = await client.callTool({ name: 'delete_report', arguments: { id: VALID_REPORT_ID } });
		expect(deleteDraftMock).toHaveBeenCalledExactlyOnceWith(VALID_REPORT_ID, TEST_SCOPE);
		expect(ok.isError).toBeFalsy();

		deleteDraftMock.mockRejectedValue(
			new AppError({
				status: 409,
				title: 'Report is published',
				type: '/problems/report-published'
			})
		);
		const conflict = await client.callTool({
			name: 'delete_report',
			arguments: { id: VALID_REPORT_ID }
		});
		expect(conflict.isError).toBe(true);
		const content = conflict.content as { type: string; text: string }[];
		expect((JSON.parse(content[0].text) as { status: number }).status).toBe(409);
	});

	it('rejects a malformed UUID at the write-tool boundary (no service call)', async () => {
		const result = await client.callTool({
			name: 'delete_report',
			arguments: { id: 'not-a-uuid' }
		});
		expect(result.isError).toBe(true);
		expect(deleteDraftMock).not.toHaveBeenCalled();
	});

	it('push_data_set ingests then auto-rebinds when a reportId is given', async () => {
		const dataSet = {
			id: '01970000-0000-7000-8000-0000000000d5',
			reportId: VALID_REPORT_ID,
			sourceFormat: 'csv'
		} as unknown as DataSet;
		ingestBytesMock.mockResolvedValue(dataSet);
		rebindReportMock.mockResolvedValue({
			report: REPORT as unknown as Awaited<ReturnType<typeof rebindReport>>['report'],
			diagnostics: [],
			summary: { total: 0, bound: 0, drifted: 0, unresolved: 0, allGreen: true },
			rebound: []
		});

		const result = await client.callTool({
			name: 'push_data_set',
			arguments: { content: 'severity\nCritical', format: 'csv', reportId: VALID_REPORT_ID }
		});

		expect(result.isError).toBeFalsy();
		expect(ingestBytesMock).toHaveBeenCalledOnce();
		expect(ingestBytesMock.mock.calls[0][0].scope).toEqual(TEST_SCOPE);
		expect(rebindReportMock).toHaveBeenCalledExactlyOnceWith(
			VALID_REPORT_ID,
			dataSet.id,
			TEST_SCOPE
		);
		const content = result.content as { type: string; text: string }[];
		const body = JSON.parse(content[0].text) as { summary: { allGreen: boolean } };
		expect(body.summary.allGreen).toBe(true);
	});

	it('rejects a malformed push_data_set reportId at the boundary (no service call)', async () => {
		const result = await client.callTool({
			name: 'push_data_set',
			arguments: { content: 'a\n1', format: 'csv', reportId: 'not-a-uuid' }
		});
		expect(result.isError).toBe(true);
		expect(ingestBytesMock).not.toHaveBeenCalled();
	});

	it('carries a 422 invalid-document error with errors[] from create_report (FR2 parity)', async () => {
		createReportWithDocumentMock.mockRejectedValue(
			new AppError({
				status: 422,
				title: 'Validation failed',
				type: '/problems/document-validation',
				errors: [{ path: 'sections.0.title', message: 'required', hint: 'Name the section.' }]
			})
		);
		const result = await client.callTool({
			name: 'create_report',
			arguments: { document: { version: 1 } }
		});
		expect(result.isError).toBe(true);
		const content = result.content as { type: string; text: string }[];
		const problem = JSON.parse(content[0].text) as {
			status: number;
			errors: { path: string; hint?: string }[];
		};
		expect(problem.status).toBe(422);
		expect(problem.errors[0]).toEqual({
			path: 'sections.0.title',
			message: 'required',
			hint: 'Name the section.'
		});
	});
});
