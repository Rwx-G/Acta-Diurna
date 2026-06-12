import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit';
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

const securityHeaders: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'no-referrer');
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

// Ordering contract: requestContext FIRST - it provides locals.requestId to
// every later handle and to handleError. securityHeaders and accessLog wrap
// the rest so even short-circuited responses (429) carry headers and a log
// line. authorRealm INNERMOST - it populates locals.authorSession during
// resolve, which accessLog reads after resolve returns to enrich its line.
export const handle: Handle = sequence(
	requestContext,
	securityHeaders,
	accessLog,
	loginRateLimit,
	authorRealm
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
