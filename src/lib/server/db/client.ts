import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { serverEnv } from '../env';
import * as schema from './schema';

let pool: pg.Pool | undefined;
let db: NodePgDatabase<typeof schema> | undefined;

export function getPool(): pg.Pool {
	return (pool ??= new pg.Pool({ connectionString: serverEnv().DATABASE_URL }));
}

export function getDb(): NodePgDatabase<typeof schema> {
	return (db ??= drizzle(getPool(), { schema }));
}
