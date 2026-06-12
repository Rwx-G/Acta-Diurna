import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/documents/reports', () => ({ unpublishToDraft: vi.fn() }));

import { unpublishToDraft, type Report } from '$lib/server/documents/reports';
import { AppError } from '$lib/server/problem';
import { POST } from './+server';

const unpublishMock = vi.mocked(unpublishToDraft);

const ID = '01970000-0000-7000-8000-000000000001';

beforeEach(() => {
	vi.clearAllMocks();
});

function event(): Parameters<typeof POST>[0] {
	return { params: { id: ID } } as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/v1/reports/:id/unpublish', () => {
	it('reverts via unpublishToDraft and returns 200', async () => {
		unpublishMock.mockResolvedValue({ id: ID, status: 'draft' } as Report);

		const response = await POST(event());

		expect(response.status).toBe(200);
		expect((await response.json()).status).toBe('draft');
		expect(unpublishMock).toHaveBeenCalledExactlyOnceWith(ID);
	});

	it('surfaces the service 404 as problem+json (thin adapter)', async () => {
		unpublishMock.mockRejectedValue(new AppError({ status: 404, title: 'Report not found' }));

		const response = await POST(event());

		expect(response.status).toBe(404);
		expect(response.headers.get('content-type')).toBe('application/problem+json');
	});
});
