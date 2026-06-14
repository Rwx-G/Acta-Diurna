import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isUnencryptedRemoteDbLink, serverEnv } from '../env';
import { logger } from '../logger';
import * as schema from './schema';

let pool: pg.Pool | undefined;
let db: NodePgDatabase<typeof schema> | undefined;

export function getPool(): pg.Pool {
	if (!pool) {
		const env = serverEnv();
		// One-time at first connect: warn (never fail) when a production link reaches
		// a REMOTE database with no TLS directive. The default compose path (a sibling
		// Postgres container by service name) is non-loopback but a private link, so a
		// non-loopback host must not block boot; a genuinely remote database should set
		// sslmode=require. Loopback and TLS-declaring URLs are exempt.
		if (isUnencryptedRemoteDbLink(env)) {
			logger.warn(
				'DATABASE_URL points at a remote host with no TLS directive: database traffic is ' +
					'unencrypted. For a remote database, set sslmode=require in the connection string.'
			);
		}
		pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: env.DB_POOL_MAX });
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
