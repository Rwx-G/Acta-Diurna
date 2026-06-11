import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './+server';
import { logger } from '$lib/server/logger';

const query = vi.fn();

vi.mock('$lib/server/db/client', () => ({
	getPool: () => ({ query })
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn() }
}));

const loggerError = vi.mocked(logger.error);

async function callGet(): Promise<Response> {
	// The handler uses no request context; healthz takes no input by design.
	return await GET({} as Parameters<typeof GET>[0]);
}

describe('GET /healthz', () => {
	beforeEach(() => {
		query.mockReset();
		loggerError.mockClear();
	});

	it('returns 200 with db ok when the database answers', async () => {
		query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

		const response = await callGet();

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'ok', db: 'ok' });
		expect(query).toHaveBeenCalledWith('SELECT 1');
	});

	it('returns 503 with db error when the database is unreachable', async () => {
		query.mockRejectedValueOnce(new Error('connection refused'));

		const response = await callGet();

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ status: 'error', db: 'error' });
		expect(loggerError).toHaveBeenCalledTimes(1);
	});
});
