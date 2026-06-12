import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getDb } from './client';
import { logger } from '../logger';

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = 2000;

// Errors that mean "Postgres is not reachable YET", not "this migration is bad".
// In compose the app can win the boot race against the db's first accepting
// connection even with depends_on healthcheck, and a transient network drop can
// hit the very first connect. These are safe to retry; anything else (a bad DDL,
// a constraint violation) must surface on the first attempt, never be retried.
//
// - ECONNREFUSED: nothing listening on the port yet.
// - ENOTFOUND / EAI_AGAIN: the db hostname does not resolve yet (compose DNS).
// - ETIMEDOUT / ECONNRESET: connection attempt dropped mid-handshake.
// - 57P03 (cannot_connect_now): Postgres is up but still starting and refuses
//   connections (recovery, initial ramp-up).
const TRANSIENT_CONNECTION_CODES = new Set([
	'ECONNREFUSED',
	'ENOTFOUND',
	'EAI_AGAIN',
	'ETIMEDOUT',
	'ECONNRESET',
	'57P03'
]);

function isTransientConnectionError(error: unknown): boolean {
	if (typeof error !== 'object' || error === null || !('code' in error)) return false;
	const { code } = error as { code: unknown };
	return typeof code === 'string' && TRANSIENT_CONNECTION_CODES.has(code);
}

interface RetryOptions {
	maxAttempts?: number;
	backoffMs?: number;
}

// Applied at boot by the init hook in hooks.server.ts, before the HTTP server
// accepts traffic. The drizzle migrator is idempotent: already-applied
// migrations (tracked in drizzle.__drizzle_migrations) are skipped.
//
// A bounded retry covers the compose boot race only: a TRANSIENT connection
// error (Postgres still coming up) is retried up to maxAttempts with a fixed
// backoff, then fails loudly. A real migration error (bad SQL, failed DDL) is
// rethrown on the first attempt - retrying it would only mask it and loop the
// container against restart:on-failure. The options exist so the unit test can
// drive the loop without real sleeps; boot uses the defaults.
export async function runMigrations({
	maxAttempts = MAX_ATTEMPTS,
	backoffMs = BACKOFF_MS
}: RetryOptions = {}): Promise<void> {
	const migrationsFolder = path.resolve(process.cwd(), 'drizzle');

	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		try {
			await migrate(getDb(), { migrationsFolder });
			return;
		} catch (error) {
			if (!isTransientConnectionError(error) || attempt === maxAttempts) {
				throw error;
			}
			logger.warn(
				{ err: error, attempt, maxAttempts },
				'database not reachable yet, retrying migration'
			);
			await delay(backoffMs);
		}
	}
}
