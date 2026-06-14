import { redirect, type Handle, type HandleServerError, type ServerInit } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { building } from '$app/environment';
import { authenticateApiToken } from '$lib/server/auth/api-tokens';
import { deleteAuthorCookie, readAuthorCookie } from '$lib/server/auth/cookies';
import {
	apiAuthFailureLimiter,
	apiAuthRateLimiter,
	GLOBAL_API_AUTH_FAILURE_KEY,
	GLOBAL_LOGIN_FAILURE_KEY,
	loginFailureLimiter,
	loginRateLimiter
} from '$lib/server/auth/rate-limit';
import { validateAuthorSession } from '$lib/server/auth/sessions';
import {
	backfillReportSeries,
	inheritLegacyOwnership,
	purgeStaleNullAuthorSessions
} from '$lib/server/authors';
import { getDb } from '$lib/server/db/client';
import { runMigrations } from '$lib/server/db/migrate';
import { serverEnv, trustsInboundForwardedHeader } from '$lib/server/env';
import { logger } from '$lib/server/logger';
import { runPurgeSweep } from '$lib/server/maintenance/purge';
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

	// One-shot at boot (never per-request): when ADDRESS_HEADER is set, adapter-node
	// derives the client IP from an inbound forwarded-for header, so per-IP rate
	// limiting is spoofable unless the fronting proxy overwrites any client-supplied
	// X-Forwarded-For (the bundled Caddy profile does). Read straight from
	// process.env because ADDRESS_HEADER is consumed by adapter-node, not the Zod
	// schema. Advisory: there is no trusted-proxy assertion to check against, so this
	// warns whenever the header is non-empty and never fails boot.
	if (trustsInboundForwardedHeader(process.env.ADDRESS_HEADER)) {
		logger.warn(
			'ADDRESS_HEADER is set: the client IP is taken from an inbound forwarded-for ' +
				'header, so per-IP rate limits are spoofable unless the fronting proxy overwrites ' +
				'any client-supplied X-Forwarded-For (the bundled Caddy profile does).'
		);
	}

	try {
		await runMigrations();
	} catch (error) {
		logger.fatal({ err: error }, 'database migration failed, refusing to start');
		throw error;
	}
	logger.info('migrations applied');

	// Ownership inheritance (story 8.2): seed the implicit author and backfill any
	// pre-8.2 (owner-less) reports/data-sets/tokens to it. Idempotent and a no-op
	// on a fully-owned database, so it runs every boot after migrations and before
	// traffic. A failure here means ownership is unenforceable, so it is fatal.
	try {
		await inheritLegacyOwnership();
		// Multi-mode boot only (no-op in single mode): drop pre-flip password author
		// sessions that carry no author id, so a single->multi flip forces a fresh
		// magic-link sign-in instead of letting a stale session act as the initial
		// owner (story 8.3 security fix).
		await purgeStaleNullAuthorSessions();
	} catch (error) {
		logger.fatal({ err: error }, 'ownership inheritance failed, refusing to start');
		throw error;
	}

	// Series lineage backfill (story 9.1): after every report carries an owner, give
	// every pre-9.1 (series-less) report a fresh single-issue series carrying that
	// owner, so no report is left without a series. Idempotent and a no-op on a
	// fully-seriesed database. A distinct try/catch so a backfill failure logs as
	// what it is, not as "ownership inheritance failed"; still fatal (the series
	// invariant the diff/navigation reads depend on must hold before traffic).
	try {
		await backfillReportSeries();
	} catch (error) {
		logger.fatal({ err: error }, 'report series backfill failed, refusing to start');
		throw error;
	}
	logger.info('ownership ready, accepting traffic');

	registerPurgeSweep(env);
};

// Periodic ephemeral-state purge (3.3 penetration audit): spent verification
// tokens + orphaned data sets. OFF under NODE_ENV=test so the suite never spawns
// a timer; unref'd so the interval never keeps the process alive on its own.
function registerPurgeSweep(env: ReturnType<typeof serverEnv>): void {
	if (env.NODE_ENV === 'test') return;
	const intervalMs = (env.PURGE_INTERVAL_MINUTES ?? 60) * 60 * 1000;
	const timer = setInterval(() => void runPurgeSweep(getDb()), intervalMs);
	timer.unref();
	logger.debug({ intervalMinutes: intervalMs / 60_000 }, 'purge sweep scheduled');
}

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
	// `same-origin`, NOT `no-referrer`: Chrome sends `Origin: null` on a form POST
	// when the document's policy is `no-referrer`, which trips SvelteKit's CSRF
	// origin check (403 "Cross-site POST form submissions are forbidden") on every
	// form in the app - login, authoring, and the reader verify card. `same-origin`
	// still sends no Referer to any cross-origin destination, so a share token in a
	// `/r/<token>` URL never leaks externally (the leak-free goal of story 3.5),
	// while same-origin POSTs carry the Origin the CSRF check needs.
	response.headers.set('Referrer-Policy', 'same-origin');
	// CSP is delivered via SvelteKit's meta-tag mode, and browsers ignore
	// frame-ancestors from a meta-delivered policy. This header-delivered
	// fallback is what actually blocks clickjacking of report content.
	response.headers.set('X-Frame-Options', 'SAMEORIGIN');
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
	// `/login` and its magic-link landing (`/login/verify`, story 8.3) are the
	// author entry points - reachable WITHOUT a session, since signing in is how a
	// session is obtained.
	if (pathname === '/login' || pathname === '/login/verify' || pathname === '/healthz') return true;
	if (pathname === '/r' || pathname.startsWith('/r/')) return true;
	// SvelteKit-served assets (built client, immutable chunks, prerendered).
	if (pathname.startsWith('/_app/') || pathname.startsWith('/.well-known/')) return true;
	if (pathname === '/favicon.ico' || pathname === '/robots.txt') return true;
	return false;
}

// The programmatic surface (D8/D10): `/api/*` is the THIRD entry realm, guarded
// by PAT bearer auth (apiAuth) and NOT by the cookie-realm workspaceGuard. An
// unauthenticated API call gets a 401 problem+json, never a 302 to /login (a
// redirect is meaningless to a script/agent). Centralized so both the auth hook
// and the guard exclusion share one definition.
export function isApiPath(pathname: string): boolean {
	return pathname === '/api' || pathname.startsWith('/api/');
}

// Public-API allowlist seam: API routes that need NO bearer. The OpenAPI spec
// (`/api/v1/openapi.json`, story 4.2) is a discovery surface that leaks no report
// data, so it is public - consistent with the 4.3 public `/api/v1/schema` (FR31).
// apiAuth lets these through with a null identity; the `/api/*` error boundary
// still wraps them.
export function isPublicApiPath(pathname: string): boolean {
	return pathname === '/api/v1/openapi.json' || pathname === '/api/v1/schema';
}

// Reads `Authorization: Bearer <token>`, returning the raw token or null. Only
// the `Bearer` scheme is accepted; a cookie is never consulted here (strict
// realm separation: a browser session must NOT authorize the API).
function readBearerToken(request: Request): string | null {
	const header = request.headers.get('authorization');
	if (!header) return null;
	// RFC 7235 BWS: tolerate a tab or repeated spaces between the scheme and the
	// token (a well-formed `Bearer\t<token>` must not fail to a 401), and trim the
	// captured token. Still strictly the `Bearer` scheme, still a single token.
	const match = /^Bearer[ \t]+(.+)$/.exec(header);
	return match ? match[1].trim() : null;
}

const unauthorizedApi = (): AppError =>
	new AppError({
		status: 401,
		title: 'Unauthorized',
		type: '/problems/unauthorized',
		detail: 'A valid API token is required. Send it as `Authorization: Bearer <token>`.',
		headers: { 'WWW-Authenticate': 'Bearer' }
	});

/**
 * PAT-bearer authentication for `/api/*` (the THIRD realm, D10). Reads the
 * Authorization Bearer token, resolves it via authenticateApiToken, and populates
 * locals.apiIdentity on success. Missing/invalid/malformed/revoked -> a 401
 * problem+json with `WWW-Authenticate: Bearer`, EXCEPT for public-API paths
 * (isPublicApiPath, the 4.3 schema seam) which pass through with a null identity.
 *
 * STRICT separation: this hook consults ONLY the Authorization header, never a
 * cookie - an author/reader cookie can never authenticate an API request. It runs
 * INSIDE apiErrorBoundary (so a thrown AppError from a downstream endpoint is
 * still formatted) but its OWN 401/429 short-circuits return problem+json
 * directly. Non-/api requests pass straight through untouched.
 *
 * Rate limiting (AR12): only a FAILED bearer attempt consumes a token (a valid
 * token costs nothing, so a legitimate script is never throttled), per-IP plus
 * the IP-independent global brake (the reverse-proxy second line). A throttled
 * caller gets a 429 problem+json with Retry-After.
 */
export const apiAuth: Handle = async ({ event, resolve }) => {
	if (!isApiPath(event.url.pathname)) return await resolve(event);

	event.locals.apiIdentity = null;

	if (isPublicApiPath(event.url.pathname)) return await resolve(event);

	const rawToken = readBearerToken(event.request);
	const identity = rawToken ? await authenticateApiToken(rawToken) : null;

	if (!identity) {
		// A failed auth attempt is the rate-limited event. Consume per-IP first,
		// then the global brake; either tripping returns the same 429.
		const perIp = apiAuthRateLimiter.consume(`${event.getClientAddress()}:/api`);
		if (!perIp.allowed) {
			logger.warn(
				{ requestId: event.locals.requestId, path: event.url.pathname, limiter: 'ip' },
				'api auth rate limit engaged'
			);
			return problemResponse(rateLimited(perIp.retryAfterSeconds));
		}
		const global = apiAuthFailureLimiter.consume(GLOBAL_API_AUTH_FAILURE_KEY);
		if (!global.allowed) {
			logger.warn(
				{ requestId: event.locals.requestId, path: event.url.pathname, limiter: 'global' },
				'api auth rate limit engaged'
			);
			return problemResponse(rateLimited(global.retryAfterSeconds));
		}
		return problemResponse(unauthorizedApi());
	}

	event.locals.apiIdentity = identity;
	return await resolve(event);
};

/**
 * The `/api/*` error boundary (backlog "Epic 4 prep - API error boundary"). Wraps
 * resolve() for API routes in a try/catch and maps a thrown AppError to its
 * problem+json (RFC 9457) with the correct status; any other (unexpected) error
 * becomes an opaque 500 problem+json, logged server-side with no internal detail
 * leaked. It wraps apiAuth so even an auth-stage throw is formatted.
 *
 * SCOPE (the 4.2 discovery): SvelteKit's internal resolve() wraps endpoint
 * execution in its OWN try/catch and routes any endpoint throw through
 * handleError (always a 500) BEFORE the throw reaches a handle hook - so this
 * boundary never sees an endpoint throw. Endpoints therefore convert their own
 * AppError to problem+json via the `runApi` wrapper ($lib/server/api). This
 * boundary remains the backstop for throws OUTSIDE an endpoint (e.g. the auth
 * stage) and is the seam 4.3 also builds on (its endpoints use `runApi` too).
 */
export const apiErrorBoundary: Handle = async ({ event, resolve }) => {
	if (!isApiPath(event.url.pathname)) return await resolve(event);

	try {
		return await resolve(event);
	} catch (thrown) {
		if (thrown instanceof AppError) {
			return problemResponse(thrown);
		}
		// Unexpected: log with the request id, leak nothing. A bare 500 problem+json.
		logger.error(
			{
				requestId: event.locals.requestId,
				method: event.request.method,
				path: event.url.pathname,
				err: thrown
			},
			'unhandled error in /api boundary'
		);
		return problemResponse(
			new AppError({
				status: 500,
				title: 'Internal Server Error',
				type: 'about:blank',
				detail: 'An unexpected error occurred.'
			})
		);
	}
};

// Defense-in-depth author guard (the critical 1.5 fix): the (workspace) layout
// `load` only guards GET page loads - it never runs for form actions or
// +server endpoints, so a POST to `?/save`/`?/delete`/`/reports/new` reached
// the action with no session. This handle short-circuits BEFORE resolve()
// (and therefore before any action runs) for every author-realm request that
// arrives without a session. Sits after authorRealm so locals.authorSession is
// already resolved. GET is redirected too (the layout still guards it; this is
// belt-and-braces).
//
// `/api/*` is EXCLUDED entirely: it is the programmatic PAT-bearer realm owned
// by apiAuth, which returns a 401 problem+json (never a 302 to /login - a
// redirect is meaningless to a script). The cookie realm must not touch it (a
// browser session never authorizes the API), so the guard skips it here and
// apiAuth is the sole gate on that path.
export const workspaceGuard: Handle = async ({ event, resolve }) => {
	if (
		event.locals.authorSession ||
		isPublicPath(event.url.pathname) ||
		isApiPath(event.url.pathname)
	) {
		return await resolve(event);
	}
	redirect(303, '/login');
};

// Ordering contract: requestContext FIRST - it provides locals.requestId to
// every later handle and to handleError. securityHeaders and accessLog wrap
// the rest so even short-circuited responses (429) carry headers and a log
// line. authorRealm populates locals.authorSession during resolve, which
// accessLog reads after resolve returns to enrich its line.
//
// The /api/* segment is two nested handles: apiErrorBoundary OUTER (it must wrap
// apiAuth + the endpoint so any thrown AppError - including from the auth stage -
// becomes problem+json), apiAuth INNER (the PAT gate). Both are no-ops on
// non-/api requests. apiErrorBoundary sits AFTER workspaceGuard in the sequence
// so the guard has already let /api/* through (it excludes the API path), and
// apiAuth is the actual gate. workspaceGuard sits AFTER authorRealm (it reads the
// session authorRealm just resolved) and short-circuits author-realm cookie
// requests with no session before any action or endpoint runs.
export const handle: Handle = sequence(
	requestContext,
	securityHeaders,
	accessLog,
	loginRateLimit,
	authorRealm,
	workspaceGuard,
	apiErrorBoundary,
	apiAuth
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
