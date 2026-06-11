import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPool } from '$lib/server/db/client';
import { logger } from '$lib/server/logger';

export const GET: RequestHandler = async () => {
	try {
		await getPool().query('SELECT 1');
		return json({ status: 'ok', db: 'ok' });
	} catch (error) {
		logger.error({ err: error }, 'healthz database check failed');
		return json({ status: 'error', db: 'error' }, { status: 503 });
	}
};
