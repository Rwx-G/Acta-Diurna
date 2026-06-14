import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/ai/generate', () => ({
	generateOutline: vi.fn(),
	hashOutline: vi.fn()
}));

vi.mock('$lib/server/mode', () => ({
	operatingMode: () => 'single',
	isMultiAuthor: () => false
}));

import { generateOutline, hashOutline, type Outline } from '$lib/server/ai/generate';
import { AppError } from '$lib/server/problem';
import { aiGenerationLimiter } from '$lib/server/auth/rate-limit';
import { POST } from './+server';

const generateOutlineMock = vi.mocked(generateOutline);
const hashOutlineMock = vi.mocked(hashOutline);

const TEST_SCOPE = { authorId: '01970000-0000-7000-8000-0000000000aa' };
const LOCALS = {
	apiIdentity: { tokenId: 'tok-outline', ownerId: TEST_SCOPE.authorId },
	requestId: 'req-1'
};

const OUTLINE: Outline = {
	title: 'Weekly Ops',
	sections: [
		{ title: 'Overview', intent: 'Set the scene', blocks: [{ type: 'text', intent: 'x' }] }
	]
};

function postRequest(body: unknown): { request: Request; locals: typeof LOCALS } {
	return {
		locals: LOCALS,
		request: new Request('http://localhost/api/v1/reports/generate/outline', {
			method: 'POST',
			body: JSON.stringify(body)
		})
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	// A fresh limiter bucket per test so the cost brake never bleeds across cases.
	(aiGenerationLimiter as unknown as { buckets: Map<string, unknown> }).buckets.clear();
});

describe('POST /api/v1/reports/generate/outline', () => {
	it('returns the outline and its hash on the happy path (one LLM call, owner-scoped)', async () => {
		generateOutlineMock.mockResolvedValue(OUTLINE);
		hashOutlineMock.mockReturnValue('hash-abc');

		const response = await POST(
			postRequest({ intent: 'A weekly ops review' }) as Parameters<typeof POST>[0]
		);

		expect(response.status).toBe(200);
		const body = (await response.json()) as { outline: Outline; outlineHash: string };
		expect(body.outline).toEqual(OUTLINE);
		expect(body.outlineHash).toBe('hash-abc');
		expect(generateOutlineMock).toHaveBeenCalledExactlyOnceWith(
			{ intent: 'A weekly ops review', skeletonId: null, dataSetId: null, requestId: 'req-1' },
			TEST_SCOPE
		);
	});

	it('passes skeleton and data set ids through to the service', async () => {
		generateOutlineMock.mockResolvedValue(OUTLINE);
		hashOutlineMock.mockReturnValue('h');

		await POST(
			postRequest({ intent: 'x', skeletonId: 'sk-1', dataSetId: 'ds-1' }) as Parameters<
				typeof POST
			>[0]
		);

		expect(generateOutlineMock.mock.calls[0][0]).toMatchObject({
			skeletonId: 'sk-1',
			dataSetId: 'ds-1'
		});
	});

	it('rejects an empty intent with a 400 problem+json (no LLM call)', async () => {
		const response = await POST(postRequest({ intent: '   ' }) as Parameters<typeof POST>[0]);
		expect(response.status).toBe(400);
		expect(response.headers.get('content-type')).toBe('application/problem+json');
		expect(generateOutlineMock).not.toHaveBeenCalled();
	});

	it('surfaces the disabled 503 from the service unchanged, makes no parse of a result', async () => {
		// The gate-closed path: the connector (inside generateOutline) throws the 503
		// BEFORE any outbound call; the route surfaces it as problem+json.
		generateOutlineMock.mockRejectedValue(
			new AppError({
				status: 503,
				title: 'AI Generation Disabled',
				type: '/problems/ai-generation-disabled'
			})
		);

		const response = await POST(postRequest({ intent: 'x' }) as Parameters<typeof POST>[0]);

		expect(response.status).toBe(503);
		expect(response.headers.get('content-type')).toBe('application/problem+json');
		const body = (await response.json()) as { type: string };
		expect(body.type).toBe('/problems/ai-generation-disabled');
	});

	it('rate-limits a token that exhausts its generation bucket (429, no LLM call)', async () => {
		generateOutlineMock.mockResolvedValue(OUTLINE);
		hashOutlineMock.mockReturnValue('h');

		// Drain the bucket (capacity 10) for this token, then the 11th is the 429.
		for (let i = 0; i < 10; i += 1) {
			await POST(postRequest({ intent: 'x' }) as Parameters<typeof POST>[0]);
		}
		const callsBefore = generateOutlineMock.mock.calls.length;

		const limited = await POST(postRequest({ intent: 'x' }) as Parameters<typeof POST>[0]);

		expect(limited.status).toBe(429);
		expect(limited.headers.get('retry-after')).toBeTruthy();
		// The denied request made no further service call.
		expect(generateOutlineMock.mock.calls.length).toBe(callsBefore);
	});
});
