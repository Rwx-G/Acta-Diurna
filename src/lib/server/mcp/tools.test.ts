import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
import {
	createReportTool,
	deleteReportTool,
	getReportTool,
	getSchemaTool,
	listReportsTool,
	listSkeletonsTool,
	publishReportTool,
	pushDataSetTool,
	unpublishReportTool,
	updateReportTool,
	type McpToolResult
} from './tools';
import { DEFAULT_REPORT_TITLE } from '$lib/server/documents/defaults';

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

const REPORT = {
	id: '01970000-0000-7000-8000-000000000001',
	title: 'Q2',
	status: 'draft'
} as Report;

function payload(result: McpToolResult): unknown {
	expect(result.content).toHaveLength(1);
	expect(result.content[0].type).toBe('text');
	return JSON.parse(result.content[0].text);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('get_schema tool', () => {
	it('returns { version, schema, examples } from the published-schema helper', async () => {
		const result = await getSchemaTool();
		expect(result.isError).toBeUndefined();
		const body = payload(result) as {
			version: number;
			schema: { $schema: string };
			examples: { minimal: unknown; full: unknown };
		};
		expect(body.version).toBeTypeOf('number');
		expect(body.schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
		expect(body.examples.minimal).toBeDefined();
		expect(body.examples.full).toBeDefined();
	});

	it('serves the schema without drifting from the committed static/schema/v1.json', async () => {
		const result = await getSchemaTool();
		const body = payload(result) as { schema: unknown };
		const committed: unknown = JSON.parse(readFileSync('static/schema/v1.json', 'utf8'));
		expect(body.schema).toEqual(committed);
	});
});

describe('list_skeletons tool', () => {
	it('delegates to listSkeletons() and wraps the summaries in an items envelope', async () => {
		const summaries = [{ id: 'sk-1', name: 'Weekly', updatedAt: new Date('2026-06-01T00:00:00Z') }];
		listSkeletonsMock.mockResolvedValue(summaries);

		const result = await listSkeletonsTool(TEST_SCOPE);

		expect(listSkeletonsMock).toHaveBeenCalledExactlyOnceWith(TEST_SCOPE);
		const body = payload(result) as { items: unknown[] };
		expect(body.items).toHaveLength(1);
	});
});

describe('list_reports tool', () => {
	it('delegates to listReports() and wraps the summaries in an items envelope', async () => {
		const summaries = [
			{
				id: 'rep-1',
				title: 'Q2',
				status: 'draft' as const,
				updatedAt: new Date('2026-06-01T00:00:00Z')
			}
		];
		listReportsMock.mockResolvedValue(summaries);

		const result = await listReportsTool(TEST_SCOPE);

		expect(listReportsMock).toHaveBeenCalledOnce();
		const body = payload(result) as { items: unknown[] };
		expect(body.items).toHaveLength(1);
	});
});

describe('get_report tool', () => {
	const REPORT_ID = '01970000-0000-7000-8000-000000000001';

	it('delegates to getReport(id) with the supplied id', async () => {
		const report = { id: REPORT_ID, title: 'Q2' } as unknown as Awaited<
			ReturnType<typeof getReport>
		>;
		getReportMock.mockResolvedValue(report);

		const result = await getReportTool(REPORT_ID, TEST_SCOPE);

		expect(getReportMock).toHaveBeenCalledWith(REPORT_ID, TEST_SCOPE);
		const body = payload(result) as { id: string };
		expect(body.id).toBe(REPORT_ID);
		expect(result.isError).toBeUndefined();
	});

	it('maps a service AppError (404) to an isError problem-details tool result', async () => {
		getReportMock.mockRejectedValue(
			new AppError({ status: 404, title: 'Report not found', type: '/problems/report-not-found' })
		);

		const result = await getReportTool('unknown', TEST_SCOPE);

		expect(result.isError).toBe(true);
		const problem = payload(result) as { type: string; title: string; status: number };
		expect(problem.status).toBe(404);
		expect(problem.type).toBe('/problems/report-not-found');
		expect(problem.title).toBe('Report not found');
	});

	it('carries the actionable errors[] of a validation AppError into the tool result', async () => {
		getReportMock.mockRejectedValue(
			new AppError({
				status: 422,
				title: 'Validation failed',
				type: '/problems/document-validation',
				errors: [{ path: 'title', message: 'required' }]
			})
		);

		const result = await getReportTool(REPORT_ID, TEST_SCOPE);

		expect(result.isError).toBe(true);
		const problem = payload(result) as { errors: { path: string }[] };
		expect(problem.errors).toEqual([{ path: 'title', message: 'required' }]);
	});

	it('re-throws a non-AppError so the SDK renders an internal error, not a tool result', async () => {
		getReportMock.mockRejectedValue(new Error('postgres://secret connection lost'));
		await expect(getReportTool(REPORT_ID, TEST_SCOPE)).rejects.toThrow('postgres://secret');
	});
});

const ID = '01970000-0000-7000-8000-000000000001';

describe('create_report tool', () => {
	it('seeds a blank starter via createReport(title) when no document is given', async () => {
		createReportMock.mockResolvedValue(REPORT);

		const result = await createReportTool({ title: 'New' }, TEST_SCOPE);

		expect(createReportMock).toHaveBeenCalledExactlyOnceWith('New', TEST_SCOPE);
		expect(createReportWithDocumentMock).not.toHaveBeenCalled();
		expect((payload(result) as { id: string }).id).toBe(REPORT.id);
		expect(result.isError).toBeUndefined();
	});

	it('falls back to the default title when none is supplied', async () => {
		createReportMock.mockResolvedValue(REPORT);

		await createReportTool({}, TEST_SCOPE);

		expect(createReportMock).toHaveBeenCalledExactlyOnceWith(DEFAULT_REPORT_TITLE, TEST_SCOPE);
	});

	it('instantiates the given document via createReportWithDocument', async () => {
		createReportWithDocumentMock.mockResolvedValue(REPORT);
		const document = { version: 1, title: 'Doc', sections: [] };

		await createReportTool({ document }, TEST_SCOPE);

		expect(createReportWithDocumentMock).toHaveBeenCalledExactlyOnceWith(document, TEST_SCOPE);
		expect(createReportMock).not.toHaveBeenCalled();
	});

	it('carries a 422 validation AppError with errors[] into an isError result (FR2 parity)', async () => {
		createReportWithDocumentMock.mockRejectedValue(
			new AppError({
				status: 422,
				title: 'Validation failed',
				type: '/problems/document-validation',
				errors: [{ path: 'sections.0.blocks.0.alt', message: 'required', hint: 'Add alt text.' }]
			})
		);

		const result = await createReportTool({ document: { version: 1 } }, TEST_SCOPE);

		expect(result.isError).toBe(true);
		const problem = payload(result) as {
			status: number;
			errors: { path: string; hint?: string }[];
		};
		expect(problem.status).toBe(422);
		expect(problem.errors[0]).toEqual({
			path: 'sections.0.blocks.0.alt',
			message: 'required',
			hint: 'Add alt text.'
		});
	});
});

describe('update_report tool', () => {
	it('routes a document-only update to updateReportDocument', async () => {
		updateReportDocumentMock.mockResolvedValue(REPORT);
		const document = { version: 1, title: 'X', sections: [] };

		await updateReportTool({ id: ID, document }, TEST_SCOPE);

		expect(updateReportDocumentMock).toHaveBeenCalledExactlyOnceWith(
			ID,
			document,
			TEST_SCOPE,
			undefined
		);
		expect(updateReportTitleMock).not.toHaveBeenCalled();
	});

	it('routes a title-only update to updateReportTitle', async () => {
		updateReportTitleMock.mockResolvedValue(REPORT);

		await updateReportTool({ id: ID, title: 'Renamed' }, TEST_SCOPE);

		expect(updateReportTitleMock).toHaveBeenCalledExactlyOnceWith(ID, 'Renamed', TEST_SCOPE);
		expect(updateReportDocumentMock).not.toHaveBeenCalled();
	});

	it('does ONE guarded write merging the title into the document when both are present', async () => {
		updateReportDocumentMock.mockResolvedValue(REPORT);

		await updateReportTool(
			{
				id: ID,
				document: { version: 1, title: 'From doc', sections: [] },
				title: 'Final'
			},
			TEST_SCOPE
		);

		expect(updateReportDocumentMock).toHaveBeenCalledExactlyOnceWith(
			ID,
			{ version: 1, title: 'Final', sections: [] },
			TEST_SCOPE,
			undefined
		);
		expect(updateReportTitleMock).not.toHaveBeenCalled();
	});

	it('passes a parsed Date as expectedUpdatedAt to the document service', async () => {
		updateReportDocumentMock.mockResolvedValue(REPORT);
		const iso = '2026-06-12T10:00:00.000Z';

		await updateReportTool(
			{ id: ID, document: { version: 1 }, expectedUpdatedAt: iso },
			TEST_SCOPE
		);

		const call = updateReportDocumentMock.mock.calls[0];
		expect(call[3]).toBeInstanceOf(Date);
		expect((call[3] as Date).toISOString()).toBe(iso);
	});

	it('surfaces the service 409 on a stale token and writes nothing else (atomic)', async () => {
		updateReportDocumentMock.mockRejectedValue(
			new AppError({
				status: 409,
				title: 'Report changed concurrently',
				type: '/problems/report-conflict'
			})
		);

		const result = await updateReportTool(
			{
				id: ID,
				document: { version: 1, title: 'D', sections: [] },
				title: 'Final',
				expectedUpdatedAt: '2026-06-12T10:00:00.000Z'
			},
			TEST_SCOPE
		);

		expect(result.isError).toBe(true);
		expect((payload(result) as { type: string }).type).toBe('/problems/report-conflict');
		expect(updateReportDocumentMock).toHaveBeenCalledOnce();
		expect(updateReportTitleMock).not.toHaveBeenCalled();
	});

	it('rejects an empty update (no title, no document) as a 400, writing nothing', async () => {
		const result = await updateReportTool({ id: ID }, TEST_SCOPE);

		expect(result.isError).toBe(true);
		expect((payload(result) as { status: number }).status).toBe(400);
		expect(updateReportDocumentMock).not.toHaveBeenCalled();
		expect(updateReportTitleMock).not.toHaveBeenCalled();
	});
});

describe('publish_report tool', () => {
	it('delegates to publishReport(id) with no token when none is given', async () => {
		publishReportMock.mockResolvedValue({ ...REPORT, status: 'published' });

		const result = await publishReportTool({ id: ID }, TEST_SCOPE);

		expect(publishReportMock).toHaveBeenCalledExactlyOnceWith(ID, TEST_SCOPE, undefined);
		expect((payload(result) as { status: string }).status).toBe('published');
	});

	it('passes a parsed Date as expectedUpdatedAt', async () => {
		publishReportMock.mockResolvedValue(REPORT);
		const iso = '2026-06-12T10:00:00.000Z';

		await publishReportTool({ id: ID, expectedUpdatedAt: iso }, TEST_SCOPE);

		const call = publishReportMock.mock.calls[0];
		expect((call[2] as Date).toISOString()).toBe(iso);
	});
});

describe('unpublish_report tool', () => {
	it('delegates to unpublishToDraft(id)', async () => {
		unpublishToDraftMock.mockResolvedValue(REPORT);

		const result = await unpublishReportTool(ID, TEST_SCOPE);

		expect(unpublishToDraftMock).toHaveBeenCalledExactlyOnceWith(ID, TEST_SCOPE);
		expect((payload(result) as { status: string }).status).toBe('draft');
	});
});

describe('delete_report tool', () => {
	it('deletes a draft via deleteDraft(id) and returns a deleted acknowledgement', async () => {
		deleteDraftMock.mockResolvedValue();

		const result = await deleteReportTool(ID, TEST_SCOPE);

		expect(deleteDraftMock).toHaveBeenCalledExactlyOnceWith(ID, TEST_SCOPE);
		expect(result.isError).toBeUndefined();
		expect(payload(result)).toEqual({ id: ID, deleted: true });
	});

	it('surfaces the service 409 when deleting a published report (no silent skip)', async () => {
		deleteDraftMock.mockRejectedValue(
			new AppError({
				status: 409,
				title: 'Report is published',
				type: '/problems/report-published'
			})
		);

		const result = await deleteReportTool(ID, TEST_SCOPE);

		expect(result.isError).toBe(true);
		const problem = payload(result) as { status: number; type: string };
		expect(problem.status).toBe(409);
		expect(problem.type).toBe('/problems/report-published');
	});
});

describe('push_data_set tool', () => {
	const DATA_SET = {
		id: '01970000-0000-7000-8000-0000000000d5',
		reportId: null,
		sourceFormat: 'csv'
	} as unknown as DataSet;

	it('ingests the content as UTF-8 bytes under the caller scope, unbound when no reportId', async () => {
		ingestBytesMock.mockResolvedValue(DATA_SET);

		const result = await pushDataSetTool(
			{ content: 'severity\nCritical', format: 'csv' },
			TEST_SCOPE
		);

		expect(ingestBytesMock).toHaveBeenCalledOnce();
		const call = ingestBytesMock.mock.calls[0][0];
		expect(new TextDecoder().decode(call.bytes)).toBe('severity\nCritical');
		expect(call.format).toBe('csv');
		expect(call.scope).toBe(TEST_SCOPE);
		expect(call.reportId).toBeNull();
		expect(rebindReportMock).not.toHaveBeenCalled();
		expect(result.isError).toBeUndefined();
		expect(payload(result)).toEqual({ dataSet: DATA_SET });
	});

	it('auto-rebinds the target report and returns diagnostics + summary when reportId is given', async () => {
		ingestBytesMock.mockResolvedValue(DATA_SET);
		const diagnostics = [{ blockId: 'severity-table', state: 'bound' }] as unknown as Awaited<
			ReturnType<typeof rebindReport>
		>['diagnostics'];
		const summary = { total: 1, allGreen: true } as unknown as Awaited<
			ReturnType<typeof rebindReport>
		>['summary'];
		rebindReportMock.mockResolvedValue({
			report: REPORT as unknown as Awaited<ReturnType<typeof rebindReport>>['report'],
			diagnostics,
			summary,
			rebound: ['severity-table']
		});

		const result = await pushDataSetTool(
			{ content: 'severity\nCritical', format: 'csv', reportId: REPORT.id },
			TEST_SCOPE
		);

		expect(ingestBytesMock.mock.calls[0][0].reportId).toBe(REPORT.id);
		expect(rebindReportMock).toHaveBeenCalledExactlyOnceWith(REPORT.id, DATA_SET.id, TEST_SCOPE);
		const body = payload(result) as { diagnostics: unknown[]; summary: unknown; rebound: string[] };
		expect(body.diagnostics).toEqual(diagnostics);
		expect(body.summary).toEqual(summary);
		expect(body.rebound).toEqual(['severity-table']);
	});

	it('passes the supplied filename through, else defaults to mcp-push.<format>', async () => {
		ingestBytesMock.mockResolvedValue(DATA_SET);

		await pushDataSetTool(
			{ content: '[]', format: 'json', filename: 'incidents.json' },
			TEST_SCOPE
		);
		expect(ingestBytesMock.mock.calls[0][0].filename).toBe('incidents.json');

		await pushDataSetTool({ content: '[]', format: 'json' }, TEST_SCOPE);
		expect(ingestBytesMock.mock.calls[1][0].filename).toBe('mcp-push.json');
	});

	it('carries the service 422 unparseable error into an isError tool result', async () => {
		ingestBytesMock.mockRejectedValue(
			new AppError({
				status: 422,
				title: 'File could not be parsed',
				type: '/problems/unparseable-file'
			})
		);

		const result = await pushDataSetTool({ content: 'not,csv\n"', format: 'csv' }, TEST_SCOPE);

		expect(result.isError).toBe(true);
		const problem = payload(result) as { status: number; type: string };
		expect(problem.status).toBe(422);
		expect(problem.type).toBe('/problems/unparseable-file');
		expect(rebindReportMock).not.toHaveBeenCalled();
	});

	it('surfaces the service 409 when the target report is published', async () => {
		ingestBytesMock.mockResolvedValue({ ...DATA_SET, reportId: REPORT.id });
		rebindReportMock.mockRejectedValue(
			new AppError({
				status: 409,
				title: 'Report is published',
				type: '/problems/report-published'
			})
		);

		const result = await pushDataSetTool(
			{ content: 'a\n1', format: 'csv', reportId: REPORT.id },
			TEST_SCOPE
		);

		expect(result.isError).toBe(true);
		expect((payload(result) as { status: number }).status).toBe(409);
	});
});
