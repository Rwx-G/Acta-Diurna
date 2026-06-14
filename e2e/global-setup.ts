import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import argon2 from 'argon2';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { reports } from '../src/lib/server/db/schema.ts';
import { validateDocument } from '../src/lib/schema/index.ts';
import {
	DATA_AS_OF_FIXTURE_DOCUMENT,
	DATA_AS_OF_FIXTURE_REPORT_ID,
	DB_URL_FILE,
	DELTA_FIRST_ISSUE_DOCUMENT,
	DELTA_FIRST_ISSUE_REPORT_ID,
	DELTA_SECOND_ISSUE_DOCUMENT,
	DELTA_SECOND_ISSUE_REPORT_ID,
	DETAIL_FIXTURE_DOCUMENT,
	DETAIL_FIXTURE_REPORT_ID,
	E2E_AUTHOR_PASSWORD,
	FIXTURE_DOCUMENT,
	FIXTURE_REPORT_ID,
	MATRIX_FIXTURE_DOCUMENT,
	MATRIX_FIXTURE_REPORT_ID,
	MERIDIAN_FIXTURE_DOCUMENT,
	MERIDIAN_FIXTURE_REPORT_ID,
	PHASE_B_FIXTURE_DOCUMENT,
	PHASE_B_FIXTURE_REPORT_ID,
	PRESENTER_FIXTURE_DOCUMENT,
	PRESENTER_FIXTURE_REPORT_ID
} from './fixtures.ts';

const PORT = 4173;
const BUILD_ENTRY = path.resolve(process.cwd(), 'build/index.js');

async function seedFixture(databaseUrl: string): Promise<void> {
	const pool = new pg.Pool({ connectionString: databaseUrl });
	try {
		const db = drizzle(pool);
		await migrate(db, { migrationsFolder: path.resolve(process.cwd(), 'drizzle') });

		const now = new Date();
		for (const { id, document } of [
			{ id: FIXTURE_REPORT_ID, document: FIXTURE_DOCUMENT },
			{ id: MATRIX_FIXTURE_REPORT_ID, document: MATRIX_FIXTURE_DOCUMENT },
			{ id: MERIDIAN_FIXTURE_REPORT_ID, document: MERIDIAN_FIXTURE_DOCUMENT },
			{ id: PHASE_B_FIXTURE_REPORT_ID, document: PHASE_B_FIXTURE_DOCUMENT },
			{ id: PRESENTER_FIXTURE_REPORT_ID, document: PRESENTER_FIXTURE_DOCUMENT },
			{ id: DATA_AS_OF_FIXTURE_REPORT_ID, document: DATA_AS_OF_FIXTURE_DOCUMENT },
			{ id: DETAIL_FIXTURE_REPORT_ID, document: DETAIL_FIXTURE_DOCUMENT },
			{ id: DELTA_FIRST_ISSUE_REPORT_ID, document: DELTA_FIRST_ISSUE_DOCUMENT },
			{ id: DELTA_SECOND_ISSUE_REPORT_ID, document: DELTA_SECOND_ISSUE_DOCUMENT }
		]) {
			const result = validateDocument(document);
			if (!result.ok) {
				throw new Error(`e2e fixture is invalid: ${JSON.stringify(result.errors.slice(0, 3))}`);
			}
			await db.insert(reports).values({
				id,
				title: result.document.title,
				status: 'published',
				schemaVersion: result.document.version,
				document: result.document,
				// Published fixture carries its publish snapshot (story 1.7): readers are
				// served `published_document`, frozen at publish time.
				publishedDocument: result.document,
				publishedAt: now,
				createdAt: now,
				updatedAt: now
			});
		}
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

	// Hand the ephemeral container URL to specs that need a DB seam (story 3.3's
	// reader-verification spec inserts a verification token with a KNOWN raw value,
	// since the magic link is only ever emailed and the at-rest hash is one-way -
	// there is no SMTP in the e2e stack to capture). Written under the gitignored
	// .auth dir, alongside the author storage state; never committed.
	mkdirSync(path.dirname(DB_URL_FILE), { recursive: true });
	writeFileSync(DB_URL_FILE, databaseUrl, 'utf8');

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
