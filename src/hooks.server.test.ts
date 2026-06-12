import { isRedirect } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import { isPublicPath, workspaceGuard } from './hooks.server';

const AUTHENTICATED = {
	id: '01970000-0000-7000-8000-000000000000',
	createdAt: new Date(),
	expiresAt: new Date(Date.now() + 60_000)
};

function eventFor(
	pathname: string,
	method: string,
	authorSession: App.Locals['authorSession']
): Parameters<typeof workspaceGuard>[0]['event'] {
	const url = new URL(`http://localhost${pathname}`);
	return {
		url,
		request: new Request(url, { method }),
		locals: { requestId: 'test', authorSession }
	} as unknown as Parameters<typeof workspaceGuard>[0]['event'];
}

async function guard(pathname: string, method: string, authorSession: App.Locals['authorSession']) {
	const resolve = vi.fn(async () => new Response('ok', { status: 200 }));
	let redirected: { status: number; location: string } | null = null;
	let response: Response | null = null;
	try {
		response = await workspaceGuard({ event: eventFor(pathname, method, authorSession), resolve });
	} catch (thrown) {
		if (isRedirect(thrown)) redirected = { status: thrown.status, location: thrown.location };
		else throw thrown;
	}
	return { resolve, redirected, response };
}

describe('isPublicPath', () => {
	it.each(['/login', '/healthz', '/r', '/r/some-token', '/_app/immutable/x.js', '/favicon.ico'])(
		'treats %s as public',
		(path) => {
			expect(isPublicPath(path)).toBe(true);
		}
	);

	it.each(['/reports', '/reports/new', '/reports/abc/edit', '/api/v1/reports', '/'])(
		'treats %s as author-realm (not public)',
		(path) => {
			expect(isPublicPath(path)).toBe(false);
		}
	);
});

describe('workspaceGuard', () => {
	it.each([
		['/reports/new', 'POST'],
		['/reports/01970000-0000-7000-8000-000000000001/edit', 'POST'],
		['/reports', 'POST']
	])(
		'redirects an unauthenticated %s %s to /login WITHOUT resolving the action',
		async (path, method) => {
			const { resolve, redirected } = await guard(path, method, null);

			expect(redirected).toEqual({ status: 303, location: '/login' });
			// The critical guarantee: the action never runs, so no DB write happens.
			expect(resolve).not.toHaveBeenCalled();
		}
	);

	it('redirects an unauthenticated workspace GET to /login (defense in depth)', async () => {
		const { resolve, redirected } = await guard('/reports', 'GET', null);

		expect(redirected).toEqual({ status: 303, location: '/login' });
		expect(resolve).not.toHaveBeenCalled();
	});

	it('returns 401 problem+json for an unauthenticated /api mutation', async () => {
		const { resolve, response } = await guard('/api/v1/reports', 'POST', null);

		expect(resolve).not.toHaveBeenCalled();
		expect(response?.status).toBe(401);
		expect(response?.headers.get('content-type')).toBe('application/problem+json');
	});

	it.each([
		['/login', 'POST'],
		['/healthz', 'GET'],
		['/r/some-token', 'GET']
	])('lets the public path %s %s through to resolve without a session', async (path, method) => {
		const { resolve, redirected } = await guard(path, method, null);

		expect(redirected).toBeNull();
		expect(resolve).toHaveBeenCalledOnce();
	});

	it('lets an authenticated author reach the action', async () => {
		const { resolve, redirected } = await guard('/reports/new', 'POST', AUTHENTICATED);

		expect(redirected).toBeNull();
		expect(resolve).toHaveBeenCalledOnce();
	});
});
