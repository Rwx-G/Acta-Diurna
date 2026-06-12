import { describe, expect, it } from 'vitest';
import { AppError, errorPageShape, problemResponse, rateLimited } from './problem';

describe('AppError', () => {
	it('defaults type to about:blank and message to the title', () => {
		const error = new AppError({ status: 404, title: 'Not Found' });

		expect(error).toBeInstanceOf(Error);
		expect(error.status).toBe(404);
		expect(error.title).toBe('Not Found');
		expect(error.type).toBe('about:blank');
		expect(error.message).toBe('Not Found');
		expect(error.detail).toBeUndefined();
		expect(error.errors).toBeUndefined();
	});

	it('carries detail, typed errors[] and headers', () => {
		const error = new AppError({
			status: 422,
			title: 'Validation Failed',
			type: 'https://acta.example/problems/validation',
			detail: 'Two fields are invalid',
			errors: [{ path: 'title', message: 'required', hint: 'add a title' }],
			headers: { 'Retry-After': '5' }
		});

		expect(error.message).toBe('Two fields are invalid');
		expect(error.errors).toHaveLength(1);
		expect(error.headers).toEqual({ 'Retry-After': '5' });
	});
});

describe('problemResponse', () => {
	it('renders RFC 9457 problem+json with the AppError status', async () => {
		const response = problemResponse(new AppError({ status: 404, title: 'Not Found' }));

		expect(response.status).toBe(404);
		expect(response.headers.get('content-type')).toBe('application/problem+json');
		expect(await response.json()).toEqual({ type: 'about:blank', title: 'Not Found', status: 404 });
	});

	it('omits absent optional members instead of sending null', async () => {
		const body = await problemResponse(new AppError({ status: 400, title: 'Bad Request' })).json();

		expect(body).not.toHaveProperty('detail');
		expect(body).not.toHaveProperty('errors');
	});

	it('includes detail, errors[] and carried headers', async () => {
		const response = problemResponse(
			new AppError({
				status: 422,
				title: 'Validation Failed',
				detail: 'One field is invalid',
				errors: [{ path: 'name', message: 'required' }],
				headers: { 'Retry-After': '7' }
			})
		);

		expect(response.headers.get('Retry-After')).toBe('7');
		expect(await response.json()).toMatchObject({
			detail: 'One field is invalid',
			errors: [{ path: 'name', message: 'required' }]
		});
	});
});

describe('rateLimited', () => {
	it('builds a constant-shape 429 with Retry-After', async () => {
		const response = problemResponse(rateLimited(30));

		expect(response.status).toBe(429);
		expect(response.headers.get('Retry-After')).toBe('30');
		expect(await response.json()).toEqual({
			type: 'about:blank',
			title: 'Too Many Requests',
			status: 429,
			detail: 'Rate limit exceeded, retry later.'
		});
	});
});

describe('errorPageShape', () => {
	it('maps an AppError to App.Error with message mirroring title', () => {
		const shape = errorPageShape(new AppError({ status: 429, title: 'Too Many Requests' }));

		expect(shape).toEqual({
			type: 'about:blank',
			title: 'Too Many Requests',
			status: 429,
			message: 'Too Many Requests'
		});
	});
});
