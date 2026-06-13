import { isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { load } from './+layout.server';

function callLoad(authorSession: App.Locals['authorSession']) {
	return load({ locals: { requestId: 'test', authorSession } } as Parameters<typeof load>[0]);
}

describe('(workspace) layout guard', () => {
	it('redirects unauthenticated requests to /login', async () => {
		try {
			await callLoad(null);
			expect.unreachable('guard must redirect');
		} catch (thrown) {
			expect(isRedirect(thrown) && thrown.status === 303 && thrown.location === '/login').toBe(
				true
			);
		}
	});

	it('lets an authenticated author through', async () => {
		await expect(
			callLoad({
				id: '01970000-0000-7000-8000-000000000000',
				authorId: null,
				createdAt: new Date(),
				expiresAt: new Date(Date.now() + 60_000)
			})
		).resolves.toBeUndefined();
	});
});
