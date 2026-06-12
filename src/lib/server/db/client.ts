import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { serverEnv } from '../env';
import { logger } from '../logger';
import * as schema from './schema';

let pool: pg.Pool | undefined;
let db: NodePgDatabase<typeof schema> | undefined;

export function getPool(): pg.Pool {
	if (!pool) {
		pool = new pg.Pool({ connectionString: serverEnv().DATABASE_URL });
		// node-postgres re-emits idle-client errors (backend restart, network
		// drop) on the pool; without a listener they crash the process.
		pool.on('error', (error) => {
			logger.error({ err: error }, 'unexpected error on idle database client');
		});
	}
	return pool;
}

export function getDb(): NodePgDatabase<typeof schema> {
	return (db ??= drizzle(getPool(), { schema }));
}
