import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { building } from '$app/environment';
import { runMigrations } from '$lib/server/db/migrate';
import { serverEnv } from '$lib/server/env';
import { logger } from '$lib/server/logger';

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

	logger.info(
		{
			requestId: event.locals.requestId,
			method: event.request.method,
			path: event.url.pathname,
			status: response.status,
			durationMs: Math.round(performance.now() - start)
		},
		'request'
	);
	return response;
};

export const handle: Handle = sequence(requestContext, securityHeaders, accessLog);

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
	// Never leak internals to the client; RFC 9457 problem-details shape
	// (message is required by SvelteKit's App.Error and mirrors title).
	return {
		type: 'about:blank',
		title: 'Internal Server Error',
		status: 500,
		message: 'Internal Server Error'
	};
};
