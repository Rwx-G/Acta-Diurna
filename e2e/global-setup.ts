import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import argon2 from 'argon2';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { reports } from '../src/lib/server/db/schema.ts';
import { validateDocument } from '../src/lib/schema/index.ts';
import { E2E_AUTHOR_PASSWORD, FIXTURE_DOCUMENT, FIXTURE_REPORT_ID } from './fixtures.ts';

const PORT = 4173;
const BUILD_ENTRY = path.resolve(process.cwd(), 'build/index.js');

async function seedFixture(databaseUrl: string): Promise<void> {
	const pool = new pg.Pool({ connectionString: databaseUrl });
	try {
		const db = drizzle(pool);
		await migrate(db, { migrationsFolder: path.resolve(process.cwd(), 'drizzle') });

		const result = validateDocument(FIXTURE_DOCUMENT);
		if (!result.ok) {
			throw new Error(`e2e fixture is invalid: ${JSON.stringify(result.errors.slice(0, 3))}`);
		}
		const now = new Date();
		await db.insert(reports).values({
			id: FIXTURE_REPORT_ID,
			title: result.document.title,
			status: 'published',
			schemaVersion: result.document.version,
			document: result.document,
			createdAt: now,
			updatedAt: now
		});
	} finally {
		await pool.end();
	}
}

async function waitForHealth(timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`http://localhost:${PORT}/healthz`);
			if (response.ok) return;
		} catch {
			// server not up yet
		}
		await new Promise((resolve) => setTimeout(resolve, 300));
	}
	throw new Error(`e2e server did not become healthy within ${timeoutMs}ms`);
}

/**
 * Playwright globalSetup: start the Postgres testcontainer, migrate + seed the
 * fixture report, then spawn `node build` against it and wait for /healthz.
 * Returns a teardown that stops the server and the container. Owning the whole
 * lifecycle here (rather than via Playwright's webServer) guarantees correct
 * ordering and a single container per run.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
	const container = await new PostgreSqlContainer('postgres:17-alpine')
		.withDatabase('acta_e2e')
		.withUsername('acta')
		.withPassword('acta')
		.start();

	const databaseUrl = container.getConnectionUri();
	await seedFixture(databaseUrl);

	const authorPasswordHash = await argon2.hash(E2E_AUTHOR_PASSWORD, { type: argon2.argon2id });
	const server: ChildProcess = spawn(process.execPath, [BUILD_ENTRY], {
		stdio: 'inherit',
		env: {
			...process.env,
			NODE_ENV: 'production',
			PORT: String(PORT),
			ORIGIN: `http://localhost:${PORT}`,
			LOG_LEVEL: 'warn',
			DATABASE_URL: databaseUrl,
			// test-only; never a production secret
			SESSION_SECRET: 'e2e-session-secret-at-least-32-characters-long',
			AUTHOR_PASSWORD_HASH: authorPasswordHash
		}
	});

	try {
		await waitForHealth(45_000);
	} catch (error) {
		server.kill();
		await container.stop();
		throw error;
	}

	return async () => {
		server.kill();
		await container.stop();
	};
}
