import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit';
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

export const handle: Handle = async ({ event, resolve }) => {
	const requestId = crypto.randomUUID();
	event.locals.requestId = requestId;
	const start = performance.now();

	const response = await resolve(event);

	logger.info(
		{
			requestId,
			method: event.request.method,
			path: event.url.pathname,
			status: response.status,
			durationMs: Math.round(performance.now() - start)
		},
		'request'
	);
	return response;
};

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
	// Never leak internals to the client (problem+json shaping arrives with the API layer).
	return { message: 'Internal Error' };
};
