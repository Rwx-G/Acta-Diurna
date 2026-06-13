import { isRedirect, redirect, type ActionFailure } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { runAction } from './action';
import { AppError } from './problem';

describe('runAction', () => {
	it('returns the body result unchanged on success', async () => {
		const result = await runAction(
			async () => ({ savedAt: 'now' }),
			(problem) => ({ message: problem.message, errors: problem.errors })
		);
		expect(result).toEqual({ savedAt: 'now' });
	});

	it('maps a thrown AppError to a fail() with the shaped payload and the right status', async () => {
		const result = (await runAction(
			async () => {
				throw new AppError({
					status: 422,
					title: 'Document validation failed',
					type: '/problems/document-validation',
					detail: '1 validation error found in the document.',
					errors: [{ path: 'sections[0].title', message: 'A section needs a title.' }]
				});
			},
			(problem) => ({ message: problem.message, errors: problem.errors })
		)) as ActionFailure<{ message: string; errors: { path: string }[] }>;

		expect(result.status).toBe(422);
		expect(result.data.message).toBe('1 validation error found in the document.');
		expect(result.data.errors[0].path).toBe('sections[0].title');
	});

	it('derives message from the title when the AppError has no detail', async () => {
		const result = (await runAction(
			async () => {
				throw new AppError({ status: 409, title: 'Conflict', type: '/problems/x' });
			},
			(problem) => ({ message: problem.message, errors: problem.errors })
		)) as ActionFailure<{ message: string; errors: unknown[] }>;

		expect(result.status).toBe(409);
		expect(result.data.message).toBe('Conflict');
	});

	it('always presents errors as an array, even when the AppError carries none', async () => {
		const result = (await runAction(
			async () => {
				throw new AppError({ status: 502, title: 'Upstream', type: '/problems/x' });
			},
			(problem) => ({ message: problem.message, errors: problem.errors })
		)) as ActionFailure<{ errors: unknown[] }>;

		expect(result.data.errors).toEqual([]);
	});

	it('lets the call site key the failure under a nested object (the generate shape)', async () => {
		const result = (await runAction(
			async () => {
				throw new AppError({
					status: 503,
					title: 'AI Generation Disabled',
					type: '/problems/ai-generation-disabled',
					detail: 'AI generation is disabled.'
				});
			},
			(problem) => ({ generate: { message: problem.message } })
		)) as ActionFailure<{ generate: { message: string } }>;

		expect(result.status).toBe(503);
		expect(result.data.generate.message).toBe('AI generation is disabled.');
	});

	it('re-throws a non-AppError so the unexpected-500 path owns it', async () => {
		const boom = new Error('db exploded');
		await expect(
			runAction(
				async () => Promise.reject(boom),
				() => ({ message: 'unused', errors: [] })
			)
		).rejects.toBe(boom);
	});

	it('lets a redirect() throw propagate (logout must redirect, never be caught)', async () => {
		try {
			await runAction(
				async () => {
					redirect(303, '/login');
				},
				() => ({ message: 'unused', errors: [] })
			);
			expect.unreachable('redirect must propagate');
		} catch (thrown) {
			expect(isRedirect(thrown) && thrown.status === 303 && thrown.location === '/login').toBe(
				true
			);
		}
	});
});
