import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/ingestion', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/ingestion')>();
	return {
		...actual,
		ingestBytes: vi.fn(),
		rebindReport: vi.fn()
	};
});

import { ingestBytes, rebindReport, type DataSet, type RebindResult } from '$lib/server/ingestion';
import { AppError } from '$lib/server/problem';
import { POST } from './+server';

const ingestBytesMock = vi.mocked(ingestBytes);
const rebindReportMock = vi.mocked(rebindReport);

const REPORT_ID = '01970000-0000-7000-8000-000000000001';
const DATA_SET_ID = '01970000-0000-7000-8000-0000000000aa';

const DATA_SET: DataSet = {
	id: DATA_SET_ID,
	reportId: REPORT_ID,
	filename: 'api-push.csv',
	sourceFormat: 'csv',
	fields: [{ name: 'severity', type: 'string' }],
	injectedAt: new Date('2026-06-12T10:00:00.000Z'),
	dataAsOf: null,
	storagePath: `/uploads/${DATA_SET_ID}.csv`
};

function post(options: {
	body: string;
	contentType?: string;
	reportId?: string | null;
	headers?: Record<string, string>;
}): Parameters<typeof POST>[0] {
	const reportId = options.reportId === undefined ? REPORT_ID : options.reportId;
	const query = reportId === null ? '' : `?reportId=${reportId}`;
	const headers: Record<string, string> = {
		'content-type': options.contentType ?? 'text/csv',
		...options.headers
	};
	const request = new Request(`http://localhost/api/v1/data-sets${query}`, {
		method: 'POST',
		headers,
		body: options.body
	});
	return {
		request,
		url: new URL(`http://localhost/api/v1/data-sets${query}`)
	} as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('POST /api/v1/data-sets', () => {
	it('pushes a CSV onto a report: stores the data set and returns the rebind diagnostics (201)', async () => {
		ingestBytesMock.mockResolvedValue(DATA_SET);
		const result: RebindResult = {
			report: { id: REPORT_ID } as RebindResult['report'],
			diagnostics: [
				{ blockId: 'b1', blockType: 'table', label: 'Metrics - table', state: 'bound', drifts: [] }
			],
			summary: { total: 1, bound: 1, drifted: 0, unresolved: 0, allGreen: true },
			rebound: ['b1']
		};
		rebindReportMock.mockResolvedValue(result);

		const response = await POST(post({ body: 'severity,count\nCritical,4' }));

		expect(response.status).toBe(201);
		const body = (await response.json()) as {
			dataSet: { id: string };
			diagnostics: unknown[];
			summary: { allGreen: boolean };
			rebound: string[];
		};
		expect(body.dataSet.id).toBe(DATA_SET_ID);
		expect(body.summary.allGreen).toBe(true);
		expect(body.rebound).toEqual(['b1']);
		// REUSE assertion: the push delegates to the SAME ingestion + rebind services.
		expect(ingestBytesMock).toHaveBeenCalledOnce();
		const ingestArg = ingestBytesMock.mock.calls[0][0];
		expect(ingestArg.format).toBe('csv');
		expect(ingestArg.reportId).toBe(REPORT_ID);
		expect(rebindReportMock).toHaveBeenCalledExactlyOnceWith(REPORT_ID, DATA_SET_ID);
	});

	it('derives JSON format from the Content-Type', async () => {
		ingestBytesMock.mockResolvedValue({ ...DATA_SET, sourceFormat: 'json' });
		rebindReportMock.mockResolvedValue({
			report: {} as RebindResult['report'],
			diagnostics: [],
			summary: { total: 0, bound: 0, drifted: 0, unresolved: 0, allGreen: false },
			rebound: []
		});

		await POST(post({ body: '[{"a":1}]', contentType: 'application/json' }));

		expect(ingestBytesMock.mock.calls[0][0].format).toBe('json');
	});

	it('surfaces a drift diagnostic with the closest match (FR15 parity)', async () => {
		ingestBytesMock.mockResolvedValue(DATA_SET);
		rebindReportMock.mockResolvedValue({
			report: {} as RebindResult['report'],
			diagnostics: [
				{
					blockId: 'b1',
					blockType: 'table',
					label: 'Metrics - table',
					state: 'drifted',
					drifts: [{ expected: 'count', closest: 'counts', distance: 1 }]
				}
			],
			summary: { total: 1, bound: 0, drifted: 1, unresolved: 0, allGreen: false },
			rebound: []
		});

		const response = await POST(post({ body: 'severity,counts\nCritical,4' }));
		const body = (await response.json()) as {
			diagnostics: Array<{ state: string; drifts: Array<{ closest: string }> }>;
		};
		expect(body.diagnostics[0].state).toBe('drifted');
		expect(body.diagnostics[0].drifts[0].closest).toBe('counts');
	});

	it('stores an unbound data set when no reportId is given (no rebind)', async () => {
		ingestBytesMock.mockResolvedValue({ ...DATA_SET, reportId: null });

		const response = await POST(post({ body: 'a,b\n1,2', reportId: null }));

		expect(response.status).toBe(201);
		const body = (await response.json()) as { dataSet: unknown; diagnostics?: unknown };
		expect(body.dataSet).toBeDefined();
		expect(body.diagnostics).toBeUndefined();
		expect(rebindReportMock).not.toHaveBeenCalled();
		expect(ingestBytesMock.mock.calls[0][0].reportId).toBeNull();
	});

	it('returns 415 (not enabled) for an Excel content-type, before any ingest', async () => {
		const response = await POST(
			post({
				body: 'x',
				contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
			})
		);
		expect(response.status).toBe(415);
		expect(((await response.json()) as { type: string }).type).toBe('/problems/excel-not-enabled');
		expect(ingestBytesMock).not.toHaveBeenCalled();
	});

	it('returns 415 for an unsupported content-type', async () => {
		const response = await POST(post({ body: 'x', contentType: 'application/xml' }));
		expect(response.status).toBe(415);
		expect(((await response.json()) as { type: string }).type).toBe('/problems/unsupported-format');
	});

	it('rejects an oversize body with 413 BEFORE parse (Content-Length guard)', async () => {
		const response = await POST(
			post({ body: 'small', headers: { 'content-length': String(60_000_000) } })
		);
		expect(response.status).toBe(413);
		expect(((await response.json()) as { type: string }).type).toBe('/problems/upload-too-large');
		expect(ingestBytesMock).not.toHaveBeenCalled();
	});

	it('rejects an empty body with 400', async () => {
		const response = await POST(post({ body: '' }));
		expect(response.status).toBe(400);
		expect(ingestBytesMock).not.toHaveBeenCalled();
	});

	it('rejects a malformed reportId with 400', async () => {
		const response = await POST(post({ body: 'a,b\n1,2', reportId: 'not-a-uuid' }));
		expect(response.status).toBe(400);
		expect(ingestBytesMock).not.toHaveBeenCalled();
	});

	it('surfaces the 409 from rebindReport on a published target (thin adapter)', async () => {
		ingestBytesMock.mockResolvedValue(DATA_SET);
		rebindReportMock.mockRejectedValue(
			new AppError({
				status: 409,
				title: 'Report is published',
				type: '/problems/report-published'
			})
		);

		const response = await POST(post({ body: 'severity,count\nCritical,4' }));

		expect(response.status).toBe(409);
		expect(response.headers.get('content-type')).toBe('application/problem+json');
	});

	it('surfaces the 422 from ingestBytes on an unparseable file (thin adapter)', async () => {
		ingestBytesMock.mockRejectedValue(
			new AppError({
				status: 422,
				title: 'File could not be parsed',
				type: '/problems/unparseable-file'
			})
		);

		const response = await POST(post({ body: 'not,valid\n"unterminated' }));

		expect(response.status).toBe(422);
		expect(response.headers.get('content-type')).toBe('application/problem+json');
	});
});
