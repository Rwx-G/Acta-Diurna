import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/ai/generate', () => ({
	fillFromOutline: vi.fn()
}));

vi.mock('$lib/server/mode', () => ({
	operatingMode: () => 'single',
	isMultiAuthor: () => false
}));

import { fillFromOutline } from '$lib/server/ai/generate';
import { AppError } from '$lib/server/problem';
import { aiGenerationLimiter } from '$lib/server/auth/rate-limit';
import type { Report } from '$lib/server/documents/reports';
import { POST } from './+server';

const fillFromOutlineMock = vi.mocked(fillFromOutline);

const TEST_SCOPE = { authorId: '01970000-0000-7000-8000-0000000000aa' };
const LOCALS = {
	apiIdentity: { tokenId: 'tok-fill', ownerId: TEST_SCOPE.authorId },
	requestId: 'req-2'
};

const REPORT = {
	id: '01970000-0000-7000-8000-000000000001',
	title: 'Weekly Ops',
	status: 'draft'
} as Report;

const OUTLINE = {
	title: 'Weekly Ops',
	sections: [{ title: 'Overview', intent: '', blocks: [{ type: 'text', intent: 'x' }] }]
};

function postRequest(body: unknown): { request: Request; locals: typeof LOCALS } {
	return {
		locals: LOCALS,
		request: new Request('http://localhost/api/v1/reports/generate/fill', {
			method: 'POST',
			body: JSON.stringify(body)
		})
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	(aiGenerationLimiter as unknown as { buckets: Map<string, unknown> }).buckets.clear();
});

describe('POST /api/v1/reports/generate/fill', () => {
	it('seeds a fresh draft (201) when no reportId is given, owner-scoped', async () => {
		fillFromOutlineMock.mockResolvedValue(REPORT);

		const response = await POST(
			postRequest({ outline: OUTLINE, outlineHash: 'hash-abc' }) as Parameters<typeof POST>[0]
		);

		expect(response.status).toBe(201);
		expect((await response.json()).id).toBe(REPORT.id);
		expect(fillFromOutlineMock).toHaveBeenCalledExactlyOnceWith(
			{
				intent: '',
				outline: OUTLINE,
				approvedHash: 'hash-abc',
				skeletonId: null,
				dataSetId: null,
				requestId: 'req-2'
			},
			TEST_SCOPE,
			undefined,
			undefined
		);
	});

	it('fills an existing draft in place (200) when a reportId is given', async () => {
		fillFromOutlineMock.mockResolvedValue(REPORT);

		const response = await POST(
			postRequest({
				outline: OUTLINE,
				outlineHash: 'hash-abc',
				reportId: REPORT.id
			}) as Parameters<typeof POST>[0]
		);

		expect(response.status).toBe(200);
		expect(fillFromOutlineMock.mock.calls[0][2]).toBe(REPORT.id);
	});

	it('threads expectedUpdatedAt through as a Date for optimistic concurrency', async () => {
		fillFromOutlineMock.mockResolvedValue(REPORT);
		const iso = '2026-06-12T10:00:00.000Z';

		await POST(
			postRequest({
				outline: OUTLINE,
				outlineHash: 'h',
				reportId: REPORT.id,
				expectedUpdatedAt: iso
			}) as Parameters<typeof POST>[0]
		);

		const passed = fillFromOutlineMock.mock.calls[0][3] as Date;
		expect(passed).toBeInstanceOf(Date);
		expect(passed.toISOString()).toBe(iso);
	});

	it('rejects a missing outlineHash with a 400 (no LLM call)', async () => {
		const response = await POST(postRequest({ outline: OUTLINE }) as Parameters<typeof POST>[0]);
		expect(response.status).toBe(400);
		expect(fillFromOutlineMock).not.toHaveBeenCalled();
	});

	it('rejects a non-object outline with a 400 (no LLM call)', async () => {
		const response = await POST(
			postRequest({ outline: 'not-an-object', outlineHash: 'h' }) as Parameters<typeof POST>[0]
		);
		expect(response.status).toBe(400);
		expect(fillFromOutlineMock).not.toHaveBeenCalled();
	});

	it('surfaces the stale-approval 409 from the service (hash mismatch) unchanged', async () => {
		fillFromOutlineMock.mockRejectedValue(
			new AppError({
				status: 409,
				title: 'Outline approval is stale',
				type: '/problems/ai-outline-stale'
			})
		);

		const response = await POST(
			postRequest({ outline: OUTLINE, outlineHash: 'wrong' }) as Parameters<typeof POST>[0]
		);

		expect(response.status).toBe(409);
		expect((await response.json()).type).toBe('/problems/ai-outline-stale');
	});

	it('surfaces the disabled 503 from the service unchanged (gate-closed path)', async () => {
		fillFromOutlineMock.mockRejectedValue(
			new AppError({
				status: 503,
				title: 'AI Generation Disabled',
				type: '/problems/ai-generation-disabled'
			})
		);

		const response = await POST(
			postRequest({ outline: OUTLINE, outlineHash: 'h' }) as Parameters<typeof POST>[0]
		);

		expect(response.status).toBe(503);
		expect((await response.json()).type).toBe('/problems/ai-generation-disabled');
	});

	it('surfaces the validator 422 with errors[] from the service (no bypass)', async () => {
		fillFromOutlineMock.mockRejectedValue(
			new AppError({
				status: 422,
				title: 'Document validation failed',
				type: '/problems/document-validation',
				errors: [{ path: 'sections[0].title', message: 'A section needs a title.' }]
			})
		);

		const response = await POST(
			postRequest({ outline: OUTLINE, outlineHash: 'h' }) as Parameters<typeof POST>[0]
		);

		expect(response.status).toBe(422);
		const body = (await response.json()) as { errors: unknown[] };
		expect(body.errors).toHaveLength(1);
	});

	it('rate-limits a token that exhausts its bucket (429, no LLM call)', async () => {
		fillFromOutlineMock.mockResolvedValue(REPORT);

		for (let i = 0; i < 10; i += 1) {
			await POST(postRequest({ outline: OUTLINE, outlineHash: 'h' }) as Parameters<typeof POST>[0]);
		}
		const callsBefore = fillFromOutlineMock.mock.calls.length;

		const limited = await POST(
			postRequest({ outline: OUTLINE, outlineHash: 'h' }) as Parameters<typeof POST>[0]
		);

		expect(limited.status).toBe(429);
		expect(fillFromOutlineMock.mock.calls.length).toBe(callsBefore);
	});
});
