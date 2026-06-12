import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
import {
	getReportTool,
	getSchemaTool,
	listReportsTool,
	listSkeletonsTool,
	type McpToolResult
} from './tools';

const listReportsMock = vi.mocked(listReports);
const getReportMock = vi.mocked(getReport);
const listSkeletonsMock = vi.mocked(listSkeletons);

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

		const result = await listSkeletonsTool();

		expect(listSkeletonsMock).toHaveBeenCalledOnce();
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

		const result = await listReportsTool();

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

		const result = await getReportTool(REPORT_ID);

		expect(getReportMock).toHaveBeenCalledWith(REPORT_ID);
		const body = payload(result) as { id: string };
		expect(body.id).toBe(REPORT_ID);
		expect(result.isError).toBeUndefined();
	});

	it('maps a service AppError (404) to an isError problem-details tool result', async () => {
		getReportMock.mockRejectedValue(
			new AppError({ status: 404, title: 'Report not found', type: '/problems/report-not-found' })
		);

		const result = await getReportTool('unknown');

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

		const result = await getReportTool(REPORT_ID);

		expect(result.isError).toBe(true);
		const problem = payload(result) as { errors: { path: string }[] };
		expect(problem.errors).toEqual([{ path: 'title', message: 'required' }]);
	});

	it('re-throws a non-AppError so the SDK renders an internal error, not a tool result', async () => {
		getReportMock.mockRejectedValue(new Error('postgres://secret connection lost'));
		await expect(getReportTool(REPORT_ID)).rejects.toThrow('postgres://secret');
	});
});
