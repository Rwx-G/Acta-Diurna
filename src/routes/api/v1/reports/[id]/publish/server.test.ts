import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/documents/reports', () => ({ publishReport: vi.fn() }));

import { publishReport, type Report } from '$lib/server/documents/reports';
import { AppError } from '$lib/server/problem';
import { POST } from './+server';

const publishMock = vi.mocked(publishReport);

const ID = '01970000-0000-7000-8000-000000000001';
const PUBLISHED = { id: ID, status: 'published' } as Report;

const TEST_SCOPE = { authorId: '01970000-0000-7000-8000-0000000000aa' };

function event(body?: string): Parameters<typeof POST>[0] {
	return {
		params: { id: ID },
		locals: { apiIdentity: { tokenId: 'tok', ownerId: TEST_SCOPE.authorId } },
		request: new Request(`http://localhost/api/v1/reports/${ID}/publish`, {
			method: 'POST',
			...(body === undefined ? {} : { body })
		})
	} as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('POST /api/v1/reports/:id/publish', () => {
	it('publishes via publishReport and returns 200 (no body, no concurrency token)', async () => {
		publishMock.mockResolvedValue(PUBLISHED);

		const response = await POST(event());

		expect(response.status).toBe(200);
		expect((await response.json()).status).toBe('published');
		expect(publishMock).toHaveBeenCalledExactlyOnceWith(ID, TEST_SCOPE, undefined);
	});

	it('passes expectedUpdatedAt when present in the body', async () => {
		publishMock.mockResolvedValue(PUBLISHED);
		const iso = '2026-06-12T10:00:00.000Z';

		await POST(event(JSON.stringify({ expectedUpdatedAt: iso })));

		const call = publishMock.mock.calls[0];
		expect((call[2] as Date).toISOString()).toBe(iso);
	});

	it('surfaces the service 422 as problem+json on an invalid draft (thin adapter)', async () => {
		publishMock.mockRejectedValue(
			new AppError({
				status: 422,
				title: 'Document validation failed',
				errors: [{ path: 'sections', message: 'empty' }]
			})
		);

		const response = await POST(event());

		expect(response.status).toBe(422);
		expect(response.headers.get('content-type')).toBe('application/problem+json');
	});
});
