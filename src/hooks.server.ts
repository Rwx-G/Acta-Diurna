import { redirect, type Handle, type HandleServerError, type ServerInit } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { building } from '$app/environment';
import { deleteAuthorCookie, readAuthorCookie } from '$lib/server/auth/cookies';
import {
	GLOBAL_LOGIN_FAILURE_KEY,
	loginFailureLimiter,
	loginRateLimiter
} from '$lib/server/auth/rate-limit';
import { validateAuthorSession } from '$lib/server/auth/sessions';
import { runMigrations } from '$lib/server/db/migrate';
import { serverEnv } from '$lib/server/env';
import { logger } from '$lib/server/logger';
import { AppError, errorPageShape, problemResponse, rateLimited } from '$lib/server/problem';

// Boot order (AR9 / FR34): validate env -> run migrations -> serve.
// adapter-node top-level-awaits server.init() (which awaits this hook) before
// the HTTP server starts listening, so a throw here prevents any traffic.
export const init: ServerInit = async () => {
	if (building) return;

	let env;
	try {
		env = serverEnv();
	} catch (error) {
		logger.fatal({ err: error }, 'invalid environment, refusing to start');
		throw error;
	}
	logger.level = env.LOG_LEVEL;
	logger.info({ nodeEnv: env.NODE_ENV, port: env.PORT }, 'environment validated');

	try {
		await runMigrations();
	} catch (error) {
		logger.fatal({ err: error }, 'database migration failed, refusing to start');
		throw error;
	}
	logger.info('migrations applied, accepting traffic');
};

const requestContext: Handle = async ({ event, resolve }) => {
	event.locals.requestId = crypto.randomUUID();
	return await resolve(event);
};

// Report-content routes that must never be indexed (NFR10). The reader view and
// the workspace preview render report bodies; the in-page <meta robots> covers
// crawlers that execute the page, this header covers those that only read
// headers. The future public reader /r/* (Epic 3) is matched here too.
function isNoindexReportPath(pathname: string): boolean {
	if (pathname === '/r' || pathname.startsWith('/r/')) return true;
	return /^\/reports\/[^/]+\/(view|preview)$/.test(pathname);
}

const securityHeaders: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'no-referrer');
	if (isNoindexReportPath(event.url.pathname)) {
		response.headers.set('X-Robots-Tag', 'noindex, nofollow');
	}
	return response;
};

const accessLog: Handle = async ({ event, resolve }) => {
	const start = performance.now();

	const response = await resolve(event);

	// Read AFTER resolve: authorRealm runs inside this handle and has populated
	// locals.authorSession by the time the response comes back.
	const session = event.locals.authorSession;
	logger.info(
		{
			requestId: event.locals.requestId,
			method: event.request.method,
			path: event.url.pathname,
			status: response.status,
			durationMs: Math.round(performance.now() - start),
			...(session ? { realm: 'author', sessionId: session.id } : {})
		},
		'request'
	);
	return response;
};

// Sits inside accessLog/securityHeaders so a 429 is still logged and carries
// the security headers. Wired only on the login action for now (AR12); other
// sensitive routes opt in with their own keys as they land.
const loginRateLimit: Handle = async ({ event, resolve }) => {
	if (event.url.pathname === '/login' && event.request.method === 'POST') {
		const decision = loginRateLimiter.consume(`${event.getClientAddress()}:/login`);
		if (!decision.allowed) {
			logger.warn(
				{ requestId: event.locals.requestId, path: event.url.pathname, limiter: 'ip' },
				'rate limit engaged'
			);
			return problemResponse(rateLimited(decision.retryAfterSeconds));
		}
		// Second, IP-independent brake: only failed login attempts consume it
		// (in the login action), so it bounds total guessing even when client
		// addresses collapse behind a proxy or are spoofed. Checked here so the
		// denial is the same 429 problem+json as the per-IP one.
		const globalDecision = loginFailureLimiter.check(GLOBAL_LOGIN_FAILURE_KEY);
		if (!globalDecision.allowed) {
			logger.warn(
				{ requestId: event.locals.requestId, path: event.url.pathname, limiter: 'global' },
				'rate limit engaged'
			);
			return problemResponse(rateLimited(globalDecision.retryAfterSeconds));
		}
	}
	return await resolve(event);
};

// Realm resolution (D4): a present author cookie is verified (HMAC, then DB
// lookup) into locals.authorSession; an invalid or expired one is cleared so
// clients do not resend it on every request.
const authorRealm: Handle = async ({ event, resolve }) => {
	event.locals.authorSession = null;

	const token = readAuthorCookie(event.cookies);
	if (token) {
		event.locals.authorSession = await validateAuthorSession(token);
		if (!event.locals.authorSession) deleteAuthorCookie(event.cookies);
	}
	return await resolve(event);
};

// Public paths reachable without an author session: the login page and its
// action, the health probe, future reader routes (`/r/...`, Epic 3), and the
// SvelteKit asset namespaces. Everything else is the author realm and requires
// a live session. Defined centrally so the guard has one source of truth.
export function isPublicPath(pathname: string): boolean {
	if (pathname === '/login' || pathname === '/healthz') return true;
	if (pathname === '/r' || pathname.startsWith('/r/')) return true;
	// SvelteKit-served assets (built client, immutable chunks, prerendered).
	if (pathname.startsWith('/_app/') || pathname.startsWith('/.well-known/')) return true;
	if (pathname === '/favicon.ico' || pathname === '/robots.txt') return true;
	return false;
}

// Defense-in-depth author guard (the critical 1.5 fix): the (workspace) layout
// `load` only guards GET page loads - it never runs for form actions or
// +server endpoints, so a POST to `?/save`/`?/delete`/`/reports/new` reached
// the action with no session. This handle short-circuits BEFORE resolve()
// (and therefore before any action runs) for every author-realm request that
// arrives without a session. Sits after authorRealm so locals.authorSession is
// already resolved. GET is redirected too (the layout still guards it; this is
// belt-and-braces). Mutations to /api/* get a 401 problem+json; page form
// posts get a 303 to /login so the no-JS flow lands somewhere sensible.
export const workspaceGuard: Handle = async ({ event, resolve }) => {
	if (event.locals.authorSession || isPublicPath(event.url.pathname)) {
		return await resolve(event);
	}
	if (event.request.method !== 'GET' && event.url.pathname.startsWith('/api/')) {
		return problemResponse(
			new AppError({
				status: 401,
				title: 'Unauthorized',
				type: '/problems/unauthenticated',
				detail: 'An author session is required.'
			})
		);
	}
	redirect(303, '/login');
};

// Ordering contract: requestContext FIRST - it provides locals.requestId to
// every later handle and to handleError. securityHeaders and accessLog wrap
// the rest so even short-circuited responses (429) carry headers and a log
// line. authorRealm INNERMOST - it populates locals.authorSession during
// resolve, which accessLog reads after resolve returns to enrich its line.
// workspaceGuard sits AFTER authorRealm (it reads the session authorRealm just
// resolved) and short-circuits author-realm requests with no session before
// any action or endpoint runs.
export const handle: Handle = sequence(
	requestContext,
	securityHeaders,
	accessLog,
	loginRateLimit,
	authorRealm,
	workspaceGuard
);

export const handleError: HandleServerError = ({ error, event, status, message }) => {
	logger.error(
		{
			requestId: event.locals.requestId,
			method: event.request.method,
			path: event.url.pathname,
			status,
			err: error
		},
		message
	);
	// Single mapping point (AR4): a thrown AppError keeps its problem-details
	// fields; for /api/* routes SvelteKit serializes this shape as JSON.
	// Anything else stays opaque: SvelteKit's status/message (e.g. 404 Not
	// Found) for client errors, a bare Internal Server Error for 5xx - never
	// leak internals to the client.
	if (error instanceof AppError) {
		return errorPageShape(error);
	}
	const title = status >= 500 ? 'Internal Server Error' : message;
	return { type: 'about:blank', title, status, message: title };
};
