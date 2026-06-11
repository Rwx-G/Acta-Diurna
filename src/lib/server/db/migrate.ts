import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getDb } from './client';

// Applied at boot by the init hook in hooks.server.ts, before the HTTP server
// accepts traffic. The drizzle migrator is idempotent: already-applied
// migrations (tracked in drizzle.__drizzle_migrations) are skipped.
export async function runMigrations(): Promise<void> {
	const migrationsFolder = path.resolve(process.cwd(), 'drizzle');
	await migrate(getDb(), { migrationsFolder });
}
