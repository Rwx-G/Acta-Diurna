import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateDocument, type DocumentV1 } from '$lib/schema';
import { AppError } from '$lib/server/problem';

// Mock the connector seam: every LLM call goes through chatComplete, and the AI
// gate is asserted via assertAiEnabled at the top of each stage. The generation
// module never fetches, so mocking these is the whole LLM surface.
const chatComplete = vi.fn();
const assertAiEnabled = vi.fn();
vi.mock('./connector', () => ({
	chatComplete: (...args: unknown[]) => chatComplete(...args),
	assertAiEnabled: (...args: unknown[]) => assertAiEnabled(...args)
}));

// Mock the service write path + the input readers. The generated document must
// go through updateReportDocument / createReportWithDocument (no bypass), so we
// assert the call, not a generation-specific write.
const updateReportDocument = vi.fn();
const createReportWithDocument = vi.fn();
vi.mock('$lib/server/documents/reports', () => ({
	updateReportDocument: (...args: unknown[]) => updateReportDocument(...args),
	createReportWithDocument: (...args: unknown[]) => createReportWithDocument(...args)
}));

vi.mock('$lib/server/mode', () => ({
	operatingMode: () => 'single',
	isMultiAuthor: () => false
}));

const TEST_SCOPE = { authorId: '01970000-0000-7000-8000-0000000000aa' };

const getSkeleton = vi.fn();
vi.mock('$lib/server/skeletons/skeletons', () => ({
	getSkeleton: (...args: unknown[]) => getSkeleton(...args)
}));

const getDataSet = vi.fn();
const readDataSetTable = vi.fn();
vi.mock('$lib/server/ingestion', () => ({
	getDataSet: (...args: unknown[]) => getDataSet(...args),
	readDataSetTable: (...args: unknown[]) => readDataSetTable(...args)
}));

import { fillFromOutline, generateOutline, hashOutline, type Outline } from './generate';

const WELL_FORMED_OUTLINE = JSON.stringify({
	title: 'Weekly Ops',
	sections: [
		{
			title: 'Overview',
			intent: 'Set the scene',
			blocks: [
				{ type: 'text', intent: 'Summarize the week' },
				{ type: 'kpi', intent: 'Headline metrics' }
			]
		},
		{
			title: 'Incidents',
			intent: 'Detail incidents',
			blocks: [{ type: 'table', intent: 'Per-incident rows' }]
		}
	]
});

function reportRow(): { updatedAt: Date } {
	return { updatedAt: new Date('2026-06-12T10:00:00Z') };
}

beforeEach(() => {
	vi.clearAllMocks();
	// clearAllMocks resets call history but KEEPS a mockImplementation, so a test
	// that makes the gate throw would leak into the next; reset it to the default
	// "enabled" no-op each time.
	assertAiEnabled.mockReset();
});

describe('generateOutline (stage 1)', () => {
	it('parses a well-formed model outline into the bounded artifact', async () => {
		chatComplete.mockResolvedValue({ content: WELL_FORMED_OUTLINE });

		const outline = await generateOutline({ intent: 'A weekly ops review' }, TEST_SCOPE);

		expect(outline.title).toBe('Weekly Ops');
		expect(outline.sections).toHaveLength(2);
		expect(outline.sections[0].blocks.map((b) => b.type)).toEqual(['text', 'kpi']);
		expect(chatComplete).toHaveBeenCalledOnce();
	});

	it('bounds the prompt: the author intent is capped before reaching the model', async () => {
		chatComplete.mockResolvedValue({ content: WELL_FORMED_OUTLINE });
		const hugeIntent = 'x'.repeat(50_000);

		await generateOutline({ intent: hugeIntent }, TEST_SCOPE);

		const messages = chatComplete.mock.calls[0][0] as { role: string; content: string }[];
		const userMessage = messages.find((m) => m.role === 'user');
		// The 2000-char cap on the author intent keeps the prompt bounded.
		expect(userMessage!.content.length).toBeLessThan(3000);
	});

	it('clamps a runaway model outline to the schema section ceiling (<= 100)', async () => {
		const runaway = {
			title: 'Runaway',
			sections: Array.from({ length: 500 }, (_, index) => ({
				title: `Section ${index}`,
				intent: '',
				blocks: [{ type: 'text', intent: '' }]
			}))
		};
		chatComplete.mockResolvedValue({ content: JSON.stringify(runaway) });

		const outline = await generateOutline({ intent: 'many sections' }, TEST_SCOPE);

		expect(outline.sections.length).toBeLessThanOrEqual(100);
	});

	it('extracts JSON even when the model wraps it in prose', async () => {
		chatComplete.mockResolvedValue({
			content: `Sure! Here is your outline:\n\n${WELL_FORMED_OUTLINE}\n\nHope that helps.`
		});

		const outline = await generateOutline({ intent: 'wrapped' }, TEST_SCOPE);

		expect(outline.sections).toHaveLength(2);
	});

	it('fails the OUTLINE stage with 502 on garbage model output, naming the stage', async () => {
		chatComplete.mockResolvedValue({ content: 'this is not json at all' });

		try {
			await generateOutline({ intent: 'garbage' }, TEST_SCOPE);
			expect.unreachable('must throw on unparseable output');
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(AppError);
			const error = thrown as AppError;
			expect(error.status).toBe(502);
			expect(error.type).toBe('/problems/ai-generation-failed');
			expect(error.detail).toContain('outline');
		}
		// No write of any kind happened on an outline failure.
		expect(updateReportDocument).not.toHaveBeenCalled();
		expect(createReportWithDocument).not.toHaveBeenCalled();
	});

	it('propagates the connector disabled 503 unchanged (no parse attempt)', async () => {
		chatComplete.mockRejectedValue(
			new AppError({
				status: 503,
				title: 'AI Generation Disabled',
				type: '/problems/ai-generation-disabled'
			})
		);

		await expect(generateOutline({ intent: 'x' }, TEST_SCOPE)).rejects.toMatchObject({
			type: '/problems/ai-generation-disabled',
			status: 503
		});
	});

	it('asserts the AI gate BEFORE loading context: a disabled instance does no DB/disk work', async () => {
		assertAiEnabled.mockImplementation(() => {
			throw new AppError({
				status: 503,
				title: 'AI Generation Disabled',
				type: '/problems/ai-generation-disabled'
			});
		});

		await expect(
			generateOutline({ intent: 'x', skeletonId: 'sk-1', dataSetId: 'ds-1' }, TEST_SCOPE)
		).rejects.toMatchObject({ type: '/problems/ai-generation-disabled', status: 503 });

		// The gate threw before any context read or model call.
		expect(getSkeleton).not.toHaveBeenCalled();
		expect(getDataSet).not.toHaveBeenCalled();
		expect(chatComplete).not.toHaveBeenCalled();
	});

	it('reads the skeleton and data set context when ids are given', async () => {
		getSkeleton.mockResolvedValue({
			document: { sections: [{ title: 'S', blocks: [{ type: 'text' }] }] }
		});
		getDataSet.mockResolvedValue({ fields: [{ name: 'count', type: 'number' }] });
		readDataSetTable.mockResolvedValue({ rows: [{ count: 3 }] });
		chatComplete.mockResolvedValue({ content: WELL_FORMED_OUTLINE });

		await generateOutline({ intent: 'x', skeletonId: 'sk-1', dataSetId: 'ds-1' }, TEST_SCOPE);

		expect(getSkeleton).toHaveBeenCalledWith('sk-1', TEST_SCOPE);
		expect(getDataSet).toHaveBeenCalledWith('ds-1', TEST_SCOPE);
		const messages = chatComplete.mock.calls[0][0] as { content: string }[];
		expect(messages[1].content).toContain('count (number)');
	});
});

describe('hashOutline + approval binding', () => {
	it('is stable for the same outline and changes when the outline changes', () => {
		const outline: Outline = {
			title: 'T',
			sections: [{ title: 'A', intent: 'i', blocks: [{ type: 'text', intent: 'b' }] }]
		};
		const hash = hashOutline(outline);
		expect(hashOutline(structuredClone(outline))).toBe(hash);

		const edited = structuredClone(outline);
		edited.sections[0].title = 'A (edited)';
		expect(hashOutline(edited)).not.toBe(hash);
	});
});

describe('fillFromOutline (stage 2)', () => {
	const outline: Outline = {
		title: 'Weekly Ops',
		sections: [
			{
				title: 'Overview',
				intent: '',
				blocks: [{ type: 'text', intent: 'Summarize' }]
			}
		]
	};

	const goodFill = JSON.stringify({
		sections: [{ blocks: [{ type: 'text', paragraphs: [['The week was steady.']] }] }]
	});

	it('rejects a stale/edited approval BEFORE any LLM call', async () => {
		const edited = structuredClone(outline);
		edited.sections[0].title = 'Tampered';

		await expect(
			fillFromOutline(
				{ intent: '', outline: edited, approvedHash: hashOutline(outline) },
				TEST_SCOPE,
				'report-1'
			)
		).rejects.toMatchObject({ type: '/problems/ai-outline-stale', status: 409 });

		expect(chatComplete).not.toHaveBeenCalled();
		expect(updateReportDocument).not.toHaveBeenCalled();
	});

	it('asserts the AI gate BEFORE the hash check or context load when disabled', async () => {
		assertAiEnabled.mockImplementation(() => {
			throw new AppError({
				status: 503,
				title: 'AI Generation Disabled',
				type: '/problems/ai-generation-disabled'
			});
		});

		await expect(
			fillFromOutline(
				{ intent: '', outline, approvedHash: hashOutline(outline) },
				TEST_SCOPE,
				'report-1'
			)
		).rejects.toMatchObject({ type: '/problems/ai-generation-disabled', status: 503 });

		expect(getSkeleton).not.toHaveBeenCalled();
		expect(getDataSet).not.toHaveBeenCalled();
		expect(chatComplete).not.toHaveBeenCalled();
		expect(updateReportDocument).not.toHaveBeenCalled();
	});

	it('persists a valid filled document via updateReportDocument (no bypass)', async () => {
		chatComplete.mockResolvedValue({ content: goodFill });
		updateReportDocument.mockResolvedValue(reportRow());

		await fillFromOutline(
			{ intent: '', outline, approvedHash: hashOutline(outline) },
			TEST_SCOPE,
			'report-1'
		);

		expect(updateReportDocument).toHaveBeenCalledOnce();
		const [id, documentInput] = updateReportDocument.mock.calls[0];
		expect(id).toBe('report-1');
		// The assembled document is well-formed and passes the real validator -
		// server-owned slug ids, the model only supplied content.
		const result = validateDocument(documentInput);
		expect(result.ok).toBe(true);
		const document = (result as { document: DocumentV1 }).document;
		expect(document.sections[0].id).toMatch(/^section-1$/);
		expect(document.sections[0].blocks[0].id).toMatch(/^block-1-1$/);
	});

	it('seeds a new draft via createReportWithDocument when no reportId is given', async () => {
		chatComplete.mockResolvedValue({ content: goodFill });
		createReportWithDocument.mockResolvedValue(reportRow());

		await fillFromOutline({ intent: '', outline, approvedHash: hashOutline(outline) }, TEST_SCOPE);

		expect(createReportWithDocument).toHaveBeenCalledOnce();
		expect(updateReportDocument).not.toHaveBeenCalled();
	});

	it('fails the content-fill stage on unparseable model output, draft untouched', async () => {
		chatComplete.mockResolvedValue({ content: 'no json here' });

		try {
			await fillFromOutline(
				{ intent: '', outline, approvedHash: hashOutline(outline) },
				TEST_SCOPE,
				'report-1'
			);
			expect.unreachable('must throw on unparseable fill');
		} catch (thrown) {
			const error = thrown as AppError;
			expect(error.status).toBe(502);
			expect(error.detail).toContain('content-fill');
		}
		expect(updateReportDocument).not.toHaveBeenCalled();
	});

	it('lets the validator reject an INVALID model document (422 errors[]) without bypass', async () => {
		// The model returns content for an outline whose ONLY section has an empty
		// title; assembleDocument keeps the (empty) title, so the real validator
		// rejects it. The write path is the gate - we route the service mock to
		// throw the validator 422 the real updateReportDocument would.
		const invalidOutline: Outline = {
			title: '',
			sections: [{ title: '', intent: '', blocks: [{ type: 'text', intent: '' }] }]
		};
		chatComplete.mockResolvedValue({ content: goodFill });
		updateReportDocument.mockRejectedValue(
			new AppError({
				status: 422,
				title: 'Document validation failed',
				type: '/problems/document-validation',
				detail: '1 validation error found in the document.',
				errors: [{ path: 'sections[0].title', message: 'A section needs a title.' }]
			})
		);

		await expect(
			fillFromOutline(
				{ intent: '', outline: invalidOutline, approvedHash: hashOutline(invalidOutline) },
				TEST_SCOPE,
				'report-1'
			)
		).rejects.toMatchObject({ status: 422, type: '/problems/document-validation' });
	});

	it('a wrong-shape object model fill is assembled defensively (fallback content), still valid', async () => {
		// Right container, wrong inner shape: an object with no `sections`. Parsed
		// defensively -> assembled from the outline with fallback text -> valid,
		// never a crash, never an invalid document.
		chatComplete.mockResolvedValue({ content: '{"unexpected": true}' });
		updateReportDocument.mockResolvedValue(reportRow());

		await fillFromOutline(
			{ intent: '', outline, approvedHash: hashOutline(outline) },
			TEST_SCOPE,
			'report-1'
		);

		const documentInput = updateReportDocument.mock.calls[0][1];
		expect(validateDocument(documentInput).ok).toBe(true);
	});

	it('an oversized/structurally-absent model fill fails cleanly (502), never crashes or persists', async () => {
		// No JSON object at all: parsed defensively to null -> a clean content-fill
		// 502, not an exception bubbling up, not a write.
		chatComplete.mockResolvedValue({ content: 'x'.repeat(300_000) });

		await expect(
			fillFromOutline(
				{ intent: '', outline, approvedHash: hashOutline(outline) },
				TEST_SCOPE,
				'report-1'
			)
		).rejects.toMatchObject({ status: 502, type: '/problems/ai-generation-failed' });
		expect(updateReportDocument).not.toHaveBeenCalled();
	});
});
