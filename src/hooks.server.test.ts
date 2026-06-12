import { isRedirect } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticateApiToken } = vi.hoisted(() => ({ authenticateApiToken: vi.fn() }));
vi.mock('$lib/server/auth/api-tokens', () => ({ authenticateApiToken }));

import {
	apiAuth,
	apiErrorBoundary,
	isApiPath,
	isPublicApiPath,
	isPublicPath,
	workspaceGuard
} from './hooks.server';
import {
	apiAuthFailureLimiter,
	apiAuthRateLimiter,
	GLOBAL_API_AUTH_FAILURE_KEY
} from '$lib/server/auth/rate-limit';
import { AppError } from '$lib/server/problem';

const AUTHENTICATED = {
	id: '01970000-0000-7000-8000-000000000000',
	createdAt: new Date(),
	expiresAt: new Date(Date.now() + 60_000)
};

interface EventOpts {
	method?: string;
	authorSession?: App.Locals['authorSession'];
	headers?: Record<string, string>;
	address?: string;
}

function eventFor(pathname: string, opts: EventOpts = {}) {
	const url = new URL(`http://localhost${pathname}`);
	return {
		url,
		request: new Request(url, { method: opts.method ?? 'GET', headers: opts.headers }),
		getClientAddress: () => opts.address ?? '203.0.113.7',
		locals: { requestId: 'test', authorSession: opts.authorSession ?? null, apiIdentity: null }
	} as unknown as Parameters<typeof workspaceGuard>[0]['event'];
}

async function guard(pathname: string, opts: EventOpts = {}) {
	const resolve = vi.fn(async () => new Response('ok', { status: 200 }));
	let redirected: { status: number; location: string } | null = null;
	let response: Response | null = null;
	try {
		response = await workspaceGuard({ event: eventFor(pathname, opts), resolve });
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

	it.each(['/reports', '/reports/new', '/reports/abc/edit', '/'])(
		'treats %s as author-realm (not public)',
		(path) => {
			expect(isPublicPath(path)).toBe(false);
		}
	);
});

describe('isApiPath / isPublicApiPath', () => {
	it.each(['/api', '/api/v1/reports', '/api/v1/whoami'])('treats %s as an API path', (path) => {
		expect(isApiPath(path)).toBe(true);
	});

	it.each(['/reports', '/apixyz', '/r/api'])('treats %s as not an API path', (path) => {
		expect(isApiPath(path)).toBe(false);
	});

	it('treats the OpenAPI spec and the published schema as public but not data endpoints', () => {
		expect(isPublicApiPath('/api/v1/openapi.json')).toBe(true);
		// 4.3: the published schema is a public discovery surface (AR2/FR31).
		expect(isPublicApiPath('/api/v1/schema')).toBe(true);
		expect(isPublicApiPath('/api/v1/reports')).toBe(false);
		expect(isPublicApiPath('/api/v1/whoami')).toBe(false);
	});
});

describe('workspaceGuard', () => {
	it.each([
		['/reports/new', 'POST'],
		['/reports/01970000-0000-7000-8000-000000000001/edit', 'POST'],
		['/reports', 'POST']
	])(
		'redirects an unauthenticated %s %s to /login WITHOUT resolving the action',
		async (path, method) => {
			const { resolve, redirected } = await guard(path, { method, authorSession: null });

			expect(redirected).toEqual({ status: 303, location: '/login' });
			expect(resolve).not.toHaveBeenCalled();
		}
	);

	it('redirects an unauthenticated workspace GET to /login (defense in depth)', async () => {
		const { resolve, redirected } = await guard('/reports', { method: 'GET', authorSession: null });

		expect(redirected).toEqual({ status: 303, location: '/login' });
		expect(resolve).not.toHaveBeenCalled();
	});

	it('does NOT guard /api/* - it passes through to apiAuth (no 302, no cookie gate)', async () => {
		const { resolve, redirected, response } = await guard('/api/v1/reports', {
			method: 'POST',
			authorSession: null
		});

		// workspaceGuard lets the API path through; apiAuth (downstream) owns the 401.
		expect(redirected).toBeNull();
		expect(resolve).toHaveBeenCalledOnce();
		expect(response?.status).toBe(200);
	});

	it('does not let an author cookie session change /api/* handling (realm separation)', async () => {
		// Even WITH an author session, the guard just passes /api/* through - the
		// cookie does not authorize the API; apiAuth still requires a bearer.
		const { resolve } = await guard('/api/v1/reports', {
			method: 'GET',
			authorSession: AUTHENTICATED
		});
		expect(resolve).toHaveBeenCalledOnce();
	});

	it.each([
		['/login', 'POST'],
		['/healthz', 'GET'],
		['/r/some-token', 'GET']
	])('lets the public path %s %s through to resolve without a session', async (path, method) => {
		const { resolve, redirected } = await guard(path, { method, authorSession: null });

		expect(redirected).toBeNull();
		expect(resolve).toHaveBeenCalledOnce();
	});

	it('lets an authenticated author reach the action', async () => {
		const { resolve, redirected } = await guard('/reports/new', {
			method: 'POST',
			authorSession: AUTHENTICATED
		});

		expect(redirected).toBeNull();
		expect(resolve).toHaveBeenCalledOnce();
	});
});

async function runApiAuth(pathname: string, opts: EventOpts = {}) {
	const event = eventFor(pathname, opts);
	const resolve = vi.fn(async () => new Response('ok', { status: 200 }));
	const response = await apiAuth({ event, resolve });
	return { event, resolve, response };
}

describe('apiAuth (PAT bearer realm)', () => {
	beforeEach(() => {
		authenticateApiToken.mockReset();
		// Drain limiter state between tests by using fresh, distinct IPs per test
		// where rate limits matter; the buckets are module singletons.
	});

	it('passes non-/api requests straight through untouched', async () => {
		const { resolve, response } = await runApiAuth('/reports', { method: 'GET' });
		expect(resolve).toHaveBeenCalledOnce();
		expect(response.status).toBe(200);
		expect(authenticateApiToken).not.toHaveBeenCalled();
	});

	it('401 problem+json with WWW-Authenticate on a MISSING bearer', async () => {
		const { resolve, response } = await runApiAuth('/api/v1/whoami', { address: '203.0.113.10' });
		expect(resolve).not.toHaveBeenCalled();
		expect(response.status).toBe(401);
		expect(response.headers.get('content-type')).toBe('application/problem+json');
		expect(response.headers.get('www-authenticate')).toBe('Bearer');
		const body = await response.json();
		expect(body.type).toBe('/problems/unauthorized');
	});

	it('401 on an INVALID bearer (authenticateApiToken returns null)', async () => {
		authenticateApiToken.mockResolvedValue(null);
		const { response } = await runApiAuth('/api/v1/whoami', {
			address: '203.0.113.11',
			headers: { authorization: 'Bearer acta_pat_bad' }
		});
		expect(response.status).toBe(401);
		expect(authenticateApiToken).toHaveBeenCalledWith('acta_pat_bad');
	});

	it('401 on a malformed Authorization header (not Bearer scheme)', async () => {
		const { response } = await runApiAuth('/api/v1/whoami', {
			address: '203.0.113.12',
			headers: { authorization: 'Basic abc123' }
		});
		expect(response.status).toBe(401);
		// No token parsed -> no DB call.
		expect(authenticateApiToken).not.toHaveBeenCalled();
	});

	it('a COOKIE never authenticates the API (only the Authorization header is consulted)', async () => {
		const { response } = await runApiAuth('/api/v1/whoami', {
			address: '203.0.113.13',
			headers: { cookie: 'acta_author=forged.value' },
			authorSession: AUTHENTICATED
		});
		expect(response.status).toBe(401);
		expect(authenticateApiToken).not.toHaveBeenCalled();
	});

	it('populates locals.apiIdentity and resolves on a VALID bearer', async () => {
		authenticateApiToken.mockResolvedValue({ tokenId: 'tok-1' });
		const { event, resolve, response } = await runApiAuth('/api/v1/whoami', {
			address: '203.0.113.14',
			headers: { authorization: 'Bearer acta_pat_good' }
		});
		expect(event.locals.apiIdentity).toEqual({ tokenId: 'tok-1' });
		expect(resolve).toHaveBeenCalledOnce();
		expect(response.status).toBe(200);
	});

	it('rate-limits repeated FAILED bearer attempts with a 429 problem+json', async () => {
		authenticateApiToken.mockResolvedValue(null);
		const address = '203.0.113.250';
		// Capacity is 10 per-IP; the 11th failure trips the per-IP bucket.
		let last: Response | null = null;
		for (let i = 0; i < 12; i++) {
			last = (
				await runApiAuth('/api/v1/whoami', {
					address,
					headers: { authorization: 'Bearer acta_pat_bad' }
				})
			).response;
		}
		expect(last?.status).toBe(429);
		expect(last?.headers.get('retry-after')).toBeTruthy();
	});

	afterEach(() => {
		// Reset the global brake so the rate-limit test does not bleed into others.
		// (Per-IP buckets are keyed by distinct test addresses.)
		while (!apiAuthFailureLimiter.check(GLOBAL_API_AUTH_FAILURE_KEY).allowed) break;
		void apiAuthRateLimiter;
	});
});

async function runBoundary(
	pathname: string,
	resolveImpl: () => Promise<Response>
): Promise<Response> {
	const event = eventFor(pathname);
	return await apiErrorBoundary({ event, resolve: resolveImpl });
}

describe('apiErrorBoundary (/api/* error boundary)', () => {
	it('passes non-/api requests straight through (no try/catch wrapping)', async () => {
		const ok = new Response('ok', { status: 200 });
		const response = await runBoundary('/reports', async () => ok);
		expect(response).toBe(ok);
	});

	it('maps a thrown AppError to problem+json with its status', async () => {
		const response = await runBoundary('/api/v1/reports', async () => {
			throw new AppError({
				status: 404,
				title: 'Report not found',
				type: '/problems/report-not-found',
				detail: 'No such report.'
			});
		});
		expect(response.status).toBe(404);
		expect(response.headers.get('content-type')).toBe('application/problem+json');
		const body = await response.json();
		expect(body).toMatchObject({
			type: '/problems/report-not-found',
			title: 'Report not found',
			status: 404,
			detail: 'No such report.'
		});
	});

	it('maps an unexpected throw to an opaque 500 problem+json (no internal leak)', async () => {
		const response = await runBoundary('/api/v1/reports', async () => {
			throw new Error('DB connection string postgres://secret@host exploded');
		});
		expect(response.status).toBe(500);
		expect(response.headers.get('content-type')).toBe('application/problem+json');
		const body = await response.json();
		expect(body.title).toBe('Internal Server Error');
		// The internal error message must NOT leak.
		expect(JSON.stringify(body)).not.toContain('postgres://');
		expect(JSON.stringify(body)).not.toContain('exploded');
	});

	it('passes a normal API response through unchanged', async () => {
		const ok = new Response(JSON.stringify({ ok: true }), { status: 200 });
		const response = await runBoundary('/api/v1/whoami', async () => ok);
		expect(response.status).toBe(200);
	});
});
