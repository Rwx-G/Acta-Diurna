import { describe, expect, it } from 'vitest';
import { runApi } from './api';
import { AppError } from './problem';

describe('runApi', () => {
	it('returns the handler response unchanged on success', async () => {
		const ok = new Response('ok', { status: 201 });
		const response = await runApi(async () => ok);
		expect(response).toBe(ok);
	});

	it('maps a thrown AppError to its problem+json response with the right status', async () => {
		const response = await runApi(async () => {
			throw new AppError({
				status: 409,
				title: 'Conflict',
				type: '/problems/x',
				detail: 'stale',
				errors: [{ path: 'a', message: 'm', hint: 'h' }]
			});
		});

		expect(response.status).toBe(409);
		expect(response.headers.get('content-type')).toBe('application/problem+json');
		const body = (await response.json()) as Record<string, unknown>;
		expect(body).toEqual({
			type: '/problems/x',
			title: 'Conflict',
			status: 409,
			detail: 'stale',
			errors: [{ path: 'a', message: 'm', hint: 'h' }]
		});
	});

	it('re-throws a non-AppError so the handle boundary / 500 path owns it', async () => {
		const boom = new Error('db exploded');
		await expect(runApi(async () => Promise.reject(boom))).rejects.toBe(boom);
	});
});
