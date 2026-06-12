import { isHttpError, isRedirect, type ActionFailure } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateDocument, type DocumentV1, type DocumentV1Input } from '$lib/schema';
import { performLogout } from '$lib/server/auth/logout';
import {
	getReport,
	publishReport,
	unpublishToDraft,
	updateReportDocument,
	type Report
} from '$lib/server/documents/reports';
import { bindBlock, listDataSets, rebindReport, remapField } from '$lib/server/ingestion';
import { listSkeletons } from '$lib/server/skeletons/skeletons';
import { isAiEnabled } from '$lib/server/ai/connector';
import { fillFromOutline, generateOutline, hashOutline } from '$lib/server/ai/generate';
import { AppError } from '$lib/server/problem';
import { actions, load } from './+page.server';

vi.mock('$lib/server/documents/reports', () => ({
	getReport: vi.fn(),
	updateReportDocument: vi.fn(),
	publishReport: vi.fn(),
	unpublishToDraft: vi.fn()
}));
vi.mock('$lib/server/ingestion', () => ({
	listDataSets: vi.fn(),
	bindBlock: vi.fn(),
	rebindReport: vi.fn(),
	remapField: vi.fn()
}));
vi.mock('$lib/server/skeletons/skeletons', () => ({ listSkeletons: vi.fn() }));
vi.mock('$lib/server/ai/connector', () => ({ isAiEnabled: vi.fn() }));
vi.mock('$lib/server/ai/generate', () => ({
	generateOutline: vi.fn(),
	fillFromOutline: vi.fn(),
	hashOutline: vi.fn()
}));
vi.mock('$lib/server/auth/logout', () => ({ performLogout: vi.fn() }));

const getReportMock = vi.mocked(getReport);
const updateMock = vi.mocked(updateReportDocument);
const publishMock = vi.mocked(publishReport);
const unpublishMock = vi.mocked(unpublishToDraft);
const listDataSetsMock = vi.mocked(listDataSets);
const bindBlockMock = vi.mocked(bindBlock);
const rebindReportMock = vi.mocked(rebindReport);
const remapFieldMock = vi.mocked(remapField);
const logoutMock = vi.mocked(performLogout);
const listSkeletonsMock = vi.mocked(listSkeletons);
const isAiEnabledMock = vi.mocked(isAiEnabled);
const generateOutlineMock = vi.mocked(generateOutline);
const fillFromOutlineMock = vi.mocked(fillFromOutline);
const hashOutlineMock = vi.mocked(hashOutline);

const REPORT_ID = '01970000-0000-7000-8000-000000000001';

function sampleDocument(): DocumentV1 {
	const input: DocumentV1Input = {
		version: 1,
		title: 'Weekly Ops',
		sections: [
			{
				id: 'overview',
				title: 'Overview',
				blocks: [{ type: 'text', id: 'intro', paragraphs: [[{ text: 'Original paragraph.' }]] }]
			}
		]
	};
	const result = validateDocument(input);
	if (!result.ok) throw new Error('sample document must be valid');
	return result.document;
}

function sampleReport(overrides: Partial<Report> = {}): Report {
	return {
		id: REPORT_ID,
		title: 'Weekly Ops',
		status: 'draft',
		schemaVersion: 1,
		document: sampleDocument(),
		publishedDocument: null,
		publishedAt: null,
		createdAt: new Date('2026-06-12T08:00:00Z'),
		updatedAt: new Date('2026-06-12T09:30:00Z'),
		...overrides
	};
}

type SaveAction = typeof actions.save;

function saveEvent(formData: FormData): Parameters<SaveAction>[0] {
	return {
		params: { id: REPORT_ID },
		request: new Request('http://localhost/reports/x/edit?/save', {
			method: 'POST',
			body: formData
		})
	} as Parameters<SaveAction>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('load', () => {
	it('returns the report, data sets, skeletons and the AI-enabled flag', async () => {
		const report = sampleReport();
		getReportMock.mockResolvedValue(report);
		listDataSetsMock.mockResolvedValue([]);
		listSkeletonsMock.mockResolvedValue([]);
		isAiEnabledMock.mockReturnValue(true);

		const result = await load({ params: { id: REPORT_ID } } as Parameters<typeof load>[0]);

		expect(result).toEqual({ report, dataSets: [], skeletons: [], aiEnabled: true });
		expect(getReportMock).toHaveBeenCalledExactlyOnceWith(REPORT_ID);
		expect(listDataSetsMock).toHaveBeenCalledOnce();
	});

	it('reports aiEnabled false when the connector is disabled (the entry point hides)', async () => {
		getReportMock.mockResolvedValue(sampleReport());
		listDataSetsMock.mockResolvedValue([]);
		listSkeletonsMock.mockResolvedValue([]);
		isAiEnabledMock.mockReturnValue(false);

		const result = await load({ params: { id: REPORT_ID } } as Parameters<typeof load>[0]);

		expect(result).toMatchObject({ aiEnabled: false });
	});

	it('translates a service 404 AppError into a SvelteKit 404', async () => {
		getReportMock.mockRejectedValue(
			new AppError({ status: 404, title: 'Report not found', type: '/problems/report-not-found' })
		);
		listDataSetsMock.mockResolvedValue([]);
		listSkeletonsMock.mockResolvedValue([]);
		isAiEnabledMock.mockReturnValue(true);

		try {
			await load({ params: { id: REPORT_ID } } as Parameters<typeof load>[0]);
			expect.unreachable('load must throw');
		} catch (thrown) {
			expect(isHttpError(thrown) && thrown.status === 404).toBe(true);
		}
	});
});

describe('save action', () => {
	it('saves the JSON document payload and returns the saved timestamp', async () => {
		const report = sampleReport({ updatedAt: new Date('2026-06-12T10:15:00Z') });
		updateMock.mockResolvedValue(report);
		const document = sampleDocument();
		const data = new FormData();
		data.set('document', JSON.stringify(document));

		const result = await actions.save(saveEvent(data));

		expect(updateMock).toHaveBeenCalledExactlyOnceWith(REPORT_ID, document);
		expect(result).toEqual({ savedAt: '2026-06-12T10:15:00.000Z' });
		expect(getReportMock).not.toHaveBeenCalled();
	});

	it('maps a 422 AppError to a failure carrying the actionable errors[]', async () => {
		updateMock.mockRejectedValue(
			new AppError({
				status: 422,
				title: 'Document validation failed',
				type: '/problems/document-validation',
				detail: '1 validation error found in the document.',
				errors: [
					{
						path: 'sections[0].blocks[0].alt',
						message: 'Alt text must not be empty.',
						hint: 'Describe the image for screen readers; alt text is required on every image block.'
					}
				]
			})
		);
		const data = new FormData();
		data.set('document', JSON.stringify(sampleDocument()));

		const result = (await actions.save(saveEvent(data))) as ActionFailure<{
			message: string;
			errors: { path: string }[];
		}>;

		expect(result.status).toBe(422);
		expect(result.data.errors).toHaveLength(1);
		expect(result.data.errors[0].path).toBe('sections[0].blocks[0].alt');
	});

	it('maps a 409 AppError (published) to a failure with a message', async () => {
		updateMock.mockRejectedValue(
			new AppError({
				status: 409,
				title: 'Report is published',
				type: '/problems/report-published',
				detail: 'Published reports are read-only.'
			})
		);
		const data = new FormData();
		data.set('document', JSON.stringify(sampleDocument()));

		const result = (await actions.save(saveEvent(data))) as ActionFailure<{ message: string }>;

		expect(result.status).toBe(409);
		expect(result.data.message).toBe('Published reports are read-only.');
	});

	it('rejects a malformed JSON payload with 400 without calling the service', async () => {
		const data = new FormData();
		data.set('document', '{not json');

		const result = (await actions.save(saveEvent(data))) as ActionFailure<{ message: string }>;

		expect(result.status).toBe(400);
		expect(updateMock).not.toHaveBeenCalled();
	});

	it('rejects an oversized payload with 413 before parsing or calling the service', async () => {
		const data = new FormData();
		data.set('document', 'x'.repeat(1_000_001));

		const result = (await actions.save(saveEvent(data))) as ActionFailure<{ message: string }>;

		expect(result.status).toBe(413);
		expect(updateMock).not.toHaveBeenCalled();
		expect(getReportMock).not.toHaveBeenCalled();
	});

	it('returns a graceful 404 failure when the report is deleted before a no-JS save', async () => {
		// getReport runs inside the action try/catch, so a report deleted between
		// load and submit on the no-JS path surfaces as a mapped failure, never a 500.
		getReportMock.mockRejectedValue(
			new AppError({ status: 404, title: 'Report not found', type: '/problems/report-not-found' })
		);
		const data = new FormData();
		data.set('title', 'Edited Without JS');

		const result = (await actions.save(saveEvent(data))) as ActionFailure<{ message: string }>;

		expect(result.status).toBe(404);
		expect(updateMock).not.toHaveBeenCalled();
	});

	it('applies posted narrative fields onto the stored document when JS is unavailable', async () => {
		const report = sampleReport();
		getReportMock.mockResolvedValue(report);
		updateMock.mockResolvedValue(report);
		const data = new FormData();
		data.set('title', 'Edited Without JS');
		data.set('section-title:0', 'Renamed Section');
		data.set('paragraph:0:0:0', 'Rewritten paragraph.');

		await actions.save(saveEvent(data));

		expect(getReportMock).toHaveBeenCalledExactlyOnceWith(REPORT_ID);
		const submitted = updateMock.mock.calls[0][1] as DocumentV1;
		expect(submitted.title).toBe('Edited Without JS');
		expect(submitted.sections[0].title).toBe('Renamed Section');
		expect(submitted.sections[0].blocks[0]).toMatchObject({
			type: 'text',
			paragraphs: [[{ text: 'Rewritten paragraph.' }]]
		});
	});
});

function actionEvent(id = REPORT_ID): { params: { id: string } } {
	return { params: { id } } as { params: { id: string } };
}

type BindAction = typeof actions.bind;

function bindEvent(form: Record<string, string>): Parameters<BindAction>[0] {
	const data = new FormData();
	for (const [key, value] of Object.entries(form)) data.set(key, value);
	return {
		params: { id: REPORT_ID },
		request: new Request('http://localhost/reports/x/edit?/bind', { method: 'POST', body: data })
	} as Parameters<BindAction>[0];
}

describe('bind action', () => {
	it('binds the named block to a data set and returns the bound timestamp', async () => {
		bindBlockMock.mockResolvedValue(sampleReport({ updatedAt: new Date('2026-06-12T11:00:00Z') }));

		const result = await actions.bind(
			bindEvent({
				blockId: 'weekly-table',
				dataSetId: '01970000-0000-7000-8000-0000000000bb',
				slotMapping: JSON.stringify({ week: { role: 'column' } })
			})
		);

		expect(bindBlockMock).toHaveBeenCalledExactlyOnceWith(
			REPORT_ID,
			'weekly-table',
			'01970000-0000-7000-8000-0000000000bb',
			{ week: { role: 'column' } }
		);
		expect(result).toEqual({ boundAt: '2026-06-12T11:00:00.000Z' });
	});

	it('rejects a missing block/data-set with 400 without calling the service', async () => {
		const result = (await actions.bind(
			bindEvent({ blockId: '', dataSetId: '', slotMapping: '{}' })
		)) as ActionFailure<{ message: string }>;

		expect(result.status).toBe(400);
		expect(bindBlockMock).not.toHaveBeenCalled();
	});

	it('rejects a malformed slot mapping with 400', async () => {
		const result = (await actions.bind(
			bindEvent({ blockId: 'b', dataSetId: 'd', slotMapping: '{not json' })
		)) as ActionFailure<{ message: string }>;

		expect(result.status).toBe(400);
		expect(bindBlockMock).not.toHaveBeenCalled();
	});

	it('maps a service 422 (incoherent mapping) to a failure', async () => {
		bindBlockMock.mockRejectedValue(
			new AppError({
				status: 422,
				title: 'File could not be parsed',
				type: '/problems/unparseable-file',
				detail: 'Table binding declares no column fields.'
			})
		);

		const result = (await actions.bind(
			bindEvent({
				blockId: 'weekly-table',
				dataSetId: 'd',
				slotMapping: JSON.stringify({ week: { role: 'x' } })
			})
		)) as ActionFailure<{ message: string }>;

		expect(result.status).toBe(422);
	});
});

type RebindAction = typeof actions.rebind;

function postEvent(action: string, form: Record<string, string>): Parameters<RebindAction>[0] {
	const data = new FormData();
	for (const [key, value] of Object.entries(form)) data.set(key, value);
	return {
		params: { id: REPORT_ID },
		request: new Request(`http://localhost/reports/x/edit?/${action}`, {
			method: 'POST',
			body: data
		})
	} as Parameters<RebindAction>[0];
}

describe('rebind action (FR14)', () => {
	it('rebinds from a data set and returns diagnostics + summary', async () => {
		rebindReportMock.mockResolvedValue({
			report: sampleReport({ updatedAt: new Date('2026-06-12T12:00:00Z') }),
			diagnostics: [
				{ blockId: 'b1', blockType: 'table', label: 'Metrics - table', state: 'bound', drifts: [] }
			],
			summary: { total: 1, bound: 1, drifted: 0, unresolved: 0, allGreen: true },
			rebound: ['b1']
		});

		const result = await actions.rebind(
			postEvent('rebind', { dataSetId: '01970000-0000-7000-8000-0000000000bb' })
		);

		expect(rebindReportMock).toHaveBeenCalledExactlyOnceWith(
			REPORT_ID,
			'01970000-0000-7000-8000-0000000000bb'
		);
		expect(result).toMatchObject({
			reboundAt: '2026-06-12T12:00:00.000Z',
			rebound: ['b1'],
			summary: { allGreen: true }
		});
	});

	it('rejects a missing data set with 400 without calling the service', async () => {
		const result = (await actions.rebind(postEvent('rebind', { dataSetId: '' }))) as ActionFailure<{
			message: string;
		}>;

		expect(result.status).toBe(400);
		expect(rebindReportMock).not.toHaveBeenCalled();
	});

	it('maps a service 422 (incoherent on fresh data) to a failure', async () => {
		rebindReportMock.mockRejectedValue(
			new AppError({
				status: 422,
				title: 'File could not be parsed',
				type: '/problems/unparseable-file',
				detail: 'Chart y value is not a number.'
			})
		);

		const result = (await actions.rebind(
			postEvent('rebind', { dataSetId: 'd' })
		)) as ActionFailure<{ message: string }>;

		expect(result.status).toBe(422);
	});
});

describe('remap action (FR15)', () => {
	it('remaps an expected field onto an available field and returns the timestamp', async () => {
		remapFieldMock.mockResolvedValue(sampleReport({ updatedAt: new Date('2026-06-12T12:30:00Z') }));

		const result = await actions.remap(
			postEvent('remap', {
				blockId: 'severity-table',
				dataSetId: 'd',
				expectedField: 'count',
				availableField: 'counts'
			})
		);

		expect(remapFieldMock).toHaveBeenCalledExactlyOnceWith(
			REPORT_ID,
			'severity-table',
			'd',
			'count',
			'counts'
		);
		expect(result).toEqual({ remappedAt: '2026-06-12T12:30:00.000Z' });
	});

	it('rejects an incomplete remap with 400 without calling the service', async () => {
		const result = (await actions.remap(
			postEvent('remap', {
				blockId: 'b',
				dataSetId: 'd',
				expectedField: 'count',
				availableField: ''
			})
		)) as ActionFailure<{ message: string }>;

		expect(result.status).toBe(400);
		expect(remapFieldMock).not.toHaveBeenCalled();
	});

	it('maps a service 404 (unknown field) to a failure', async () => {
		remapFieldMock.mockRejectedValue(
			new AppError({
				status: 404,
				title: 'Binding field not found',
				type: '/problems/binding-field-not-found',
				detail: 'No bound field "count" on this block to remap.'
			})
		);

		const result = (await actions.remap(
			postEvent('remap', {
				blockId: 'b',
				dataSetId: 'd',
				expectedField: 'count',
				availableField: 'counts'
			})
		)) as ActionFailure<{ message: string }>;

		expect(result.status).toBe(404);
	});
});

type GenerateOutlineAction = (typeof actions)['generate-outline'];

// A fresh session id per event by default: the aiGenerationLimiter is shared
// module state keyed by session, so a unique key keeps each test's bucket full
// unless a test deliberately reuses an id to exercise the limit.
let sessionCounter = 0;

function generateEvent(
	action: string,
	form: Record<string, string>,
	sessionId = `session-${(sessionCounter += 1)}`
): Parameters<GenerateOutlineAction>[0] {
	const data = new FormData();
	for (const [key, value] of Object.entries(form)) data.set(key, value);
	return {
		params: { id: REPORT_ID },
		locals: { requestId: 'req-test', authorSession: { id: sessionId } },
		request: new Request(`http://localhost/reports/x/edit?/${action}`, {
			method: 'POST',
			body: data
		})
	} as Parameters<GenerateOutlineAction>[0];
}

const sampleOutline = {
	title: 'Weekly Ops',
	sections: [{ title: 'Overview', intent: '', blocks: [{ type: 'text', intent: 'sum' }] }]
};

describe('generate-outline action (FR32 stage 1)', () => {
	it('requests an outline and returns it with its content hash', async () => {
		generateOutlineMock.mockResolvedValue(sampleOutline as never);
		hashOutlineMock.mockReturnValue('hash-abc');

		const result = (await actions['generate-outline'](
			generateEvent('generate-outline', {
				intent: 'a weekly review',
				skeletonId: '',
				dataSetId: ''
			})
		)) as { generate: { stage: string; outline: unknown; outlineHash: string } };

		expect(generateOutlineMock).toHaveBeenCalledOnce();
		expect(result.generate.stage).toBe('outline');
		expect(result.generate.outline).toEqual(sampleOutline);
		expect(result.generate.outlineHash).toBe('hash-abc');
	});

	it('rejects an empty intent with 400 without calling the connector', async () => {
		const result = (await actions['generate-outline'](
			generateEvent('generate-outline', { intent: '   ' })
		)) as ActionFailure<{ generate: { message: string } }>;

		expect(result.status).toBe(400);
		expect(generateOutlineMock).not.toHaveBeenCalled();
	});

	it('maps the connector disabled 503 to a failure (AI off -> no usable outline)', async () => {
		generateOutlineMock.mockRejectedValue(
			new AppError({
				status: 503,
				title: 'AI Generation Disabled',
				type: '/problems/ai-generation-disabled',
				detail: 'AI generation is disabled.'
			})
		);

		const result = (await actions['generate-outline'](
			generateEvent('generate-outline', { intent: 'x' })
		)) as ActionFailure<{ generate: { message: string } }>;

		expect(result.status).toBe(503);
		expect(result.data.generate.message).toContain('disabled');
	});

	it('maps an outline-stage 502 to a failure naming the stage', async () => {
		generateOutlineMock.mockRejectedValue(
			new AppError({
				status: 502,
				title: 'AI Generation Failed',
				type: '/problems/ai-generation-failed',
				detail:
					'AI generation failed at the outline stage: no usable outline. Retry the outline stage.'
			})
		);

		const result = (await actions['generate-outline'](
			generateEvent('generate-outline', { intent: 'x' })
		)) as ActionFailure<{ generate: { message: string } }>;

		expect(result.status).toBe(502);
		expect(result.data.generate.message).toContain('outline');
	});
});

describe('generate-fill action (FR32 stage 2)', () => {
	it('fills the approved outline and returns the saved timestamp', async () => {
		fillFromOutlineMock.mockResolvedValue(
			sampleReport({ updatedAt: new Date('2026-06-12T13:00:00Z') })
		);

		const result = (await actions['generate-fill'](
			generateEvent('generate-fill', {
				outline: JSON.stringify(sampleOutline),
				outlineHash: 'hash-abc'
			})
		)) as { generate: { stage: string; savedAt: string } };

		expect(fillFromOutlineMock).toHaveBeenCalledOnce();
		const [fillInput, reportId] = fillFromOutlineMock.mock.calls[0];
		expect(reportId).toBe(REPORT_ID);
		expect(fillInput.approvedHash).toBe('hash-abc');
		expect(result.generate.stage).toBe('filled');
		expect(result.generate.savedAt).toBe('2026-06-12T13:00:00.000Z');
	});

	it('rejects a stale approval (service 409) with a failure, draft untouched', async () => {
		fillFromOutlineMock.mockRejectedValue(
			new AppError({
				status: 409,
				title: 'Outline approval is stale',
				type: '/problems/ai-outline-stale',
				detail: 'The outline changed since it was approved.'
			})
		);

		const result = (await actions['generate-fill'](
			generateEvent('generate-fill', {
				outline: JSON.stringify(sampleOutline),
				outlineHash: 'stale'
			})
		)) as ActionFailure<{ generate: { message: string } }>;

		expect(result.status).toBe(409);
		expect(result.data.generate.message).toContain('changed');
	});

	it('surfaces an INVALID generated document as 422 with errors[] (the no-bypass validator)', async () => {
		fillFromOutlineMock.mockRejectedValue(
			new AppError({
				status: 422,
				title: 'Document validation failed',
				type: '/problems/document-validation',
				detail: '1 validation error found in the document.',
				errors: [{ path: 'sections[0].title', message: 'A section needs a title.' }]
			})
		);

		const result = (await actions['generate-fill'](
			generateEvent('generate-fill', {
				outline: JSON.stringify(sampleOutline),
				outlineHash: 'hash-abc'
			})
		)) as ActionFailure<{ generate: { errors: { path: string }[] } }>;

		expect(result.status).toBe(422);
		expect(result.data.generate.errors[0].path).toBe('sections[0].title');
	});

	it('rejects a missing approval hash with 400 without calling the service', async () => {
		const result = (await actions['generate-fill'](
			generateEvent('generate-fill', { outline: JSON.stringify(sampleOutline), outlineHash: '' })
		)) as ActionFailure<{ generate: { message: string } }>;

		expect(result.status).toBe(400);
		expect(fillFromOutlineMock).not.toHaveBeenCalled();
	});

	it('rejects a malformed outline payload with 400', async () => {
		const result = (await actions['generate-fill'](
			generateEvent('generate-fill', { outline: '{not json', outlineHash: 'h' })
		)) as ActionFailure<{ generate: { message: string } }>;

		expect(result.status).toBe(400);
		expect(fillFromOutlineMock).not.toHaveBeenCalled();
	});
});

describe('generate action rate limit (5.4 QA, per author session)', () => {
	it('throttles outline generation past the burst cap with 429 and no LLM call', async () => {
		generateOutlineMock.mockResolvedValue(sampleOutline as never);
		hashOutlineMock.mockReturnValue('hash-abc');
		const sessionId = 'rate-limited-outline-session';

		// Capacity is 10: the burst is allowed, the next call is throttled. Reusing
		// one session id drains that session's bucket (the cost/DoS brake).
		for (let i = 0; i < 10; i += 1) {
			const ok = await actions['generate-outline'](
				generateEvent('generate-outline', { intent: 'a weekly review' }, sessionId)
			);
			expect((ok as { generate: { stage: string } }).generate.stage).toBe('outline');
		}

		generateOutlineMock.mockClear();
		const throttled = (await actions['generate-outline'](
			generateEvent('generate-outline', { intent: 'a weekly review' }, sessionId)
		)) as ActionFailure<{ generate: { message: string } }>;

		expect(throttled.status).toBe(429);
		expect(generateOutlineMock).not.toHaveBeenCalled();
	});

	it('throttles fill generation past the burst cap with 429 and no service call', async () => {
		fillFromOutlineMock.mockResolvedValue(sampleReport());
		const sessionId = 'rate-limited-fill-session';

		for (let i = 0; i < 10; i += 1) {
			await actions['generate-fill'](
				generateEvent(
					'generate-fill',
					{ outline: JSON.stringify(sampleOutline), outlineHash: 'hash-abc' },
					sessionId
				)
			);
		}

		fillFromOutlineMock.mockClear();
		const throttled = (await actions['generate-fill'](
			generateEvent(
				'generate-fill',
				{ outline: JSON.stringify(sampleOutline), outlineHash: 'hash-abc' },
				sessionId
			)
		)) as ActionFailure<{ generate: { message: string } }>;

		expect(throttled.status).toBe(429);
		expect(fillFromOutlineMock).not.toHaveBeenCalled();
	});

	it('isolates sessions: one author at the cap does not throttle another', async () => {
		generateOutlineMock.mockResolvedValue(sampleOutline as never);
		hashOutlineMock.mockReturnValue('hash-abc');
		const drained = 'isolation-drained-session';

		for (let i = 0; i < 11; i += 1) {
			await actions['generate-outline'](
				generateEvent('generate-outline', { intent: 'x' }, drained)
			);
		}

		const other = (await actions['generate-outline'](
			generateEvent('generate-outline', { intent: 'x' }, 'isolation-fresh-session')
		)) as { generate: { stage: string } };

		expect(other.generate.stage).toBe('outline');
	});
});

describe('publish action', () => {
	it('publishes and returns the new status', async () => {
		publishMock.mockResolvedValue(sampleReport({ status: 'published' }));

		const result = await actions.publish(actionEvent() as Parameters<typeof actions.publish>[0]);

		expect(publishMock).toHaveBeenCalledExactlyOnceWith(REPORT_ID);
		expect(result).toEqual({ published: true, status: 'published' });
	});

	it('maps a 422 invalid-draft AppError to a failure carrying errors[]', async () => {
		publishMock.mockRejectedValue(
			new AppError({
				status: 422,
				title: 'Document validation failed',
				type: '/problems/document-validation',
				detail: '1 validation error found in the document.',
				errors: [{ path: 'sections', message: 'A document needs at least one section.' }]
			})
		);

		const result = (await actions.publish(
			actionEvent() as Parameters<typeof actions.publish>[0]
		)) as ActionFailure<{ errors: { path: string }[] }>;

		expect(result.status).toBe(422);
		expect(result.data.errors[0].path).toBe('sections');
	});
});

describe('unpublish action', () => {
	it('reverts to draft and returns the new status', async () => {
		unpublishMock.mockResolvedValue(sampleReport({ status: 'draft' }));

		const result = await actions.unpublish(
			actionEvent() as Parameters<typeof actions.unpublish>[0]
		);

		expect(unpublishMock).toHaveBeenCalledExactlyOnceWith(REPORT_ID);
		expect(result).toEqual({ published: false, status: 'draft' });
	});
});

describe('logout action', () => {
	it('performs the shared logout and redirects to /login', async () => {
		try {
			await actions.logout({ cookies: {} } as Parameters<typeof actions.logout>[0]);
			expect.unreachable('logout must redirect');
		} catch (thrown) {
			expect(isRedirect(thrown) && thrown.status === 303 && thrown.location === '/login').toBe(
				true
			);
		}
		expect(logoutMock).toHaveBeenCalledExactlyOnceWith({});
	});
});
