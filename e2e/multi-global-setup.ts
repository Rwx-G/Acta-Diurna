import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { reports } from '../src/lib/server/db/schema.ts';
import { validateDocument } from '../src/lib/schema/index.ts';
import {
	E2E_AUTHOR_EMAIL_DOMAIN,
	E2E_INITIAL_OWNER_EMAIL,
	E2E_MULTI_PORT,
	E2E_READER_EMAIL_DOMAIN,
	FIXTURE_DOCUMENT,
	FIXTURE_REPORT_ID,
	MAILPIT_URL_FILE,
	MULTI_DB_URL_FILE
} from './fixtures.ts';

// MULTI-mode e2e harness, the parallel of `global-setup.ts` (the single-mode one).
// It stands up TWO testcontainers - Postgres and Mailpit (the SMTP double) - then
// boots a real `node build` server with the SMTP block set, which resolves the
// instance to MULTI mode (mode.ts derives the mode from SMTP_HOST). With SMTP
// present the env superRefine REQUIRES AUTHOR_EMAIL_DOMAIN + INITIAL_OWNER_EMAIL
// (in-domain), so a clean boot is itself proof the multi-mode fail-fast passes.
//
// The two harnesses are isolated by construction: separate containers, a separate
// app port, and separate `.auth` files. The single-mode `setup`/desktop/mobile
// projects never touch this setup, and this project never touches theirs, so the
// 17 green single-mode specs are unaffected.
//
// Mailpit captures every magic link the app emails (author sign-in + reader
// verification) so the multi-mode flows run end to end against a real SMTP path
// instead of forcing token state. Requires Docker (CI runners provide it); a
// failure to start either container throws and fails the suite loudly.
const PORT = E2E_MULTI_PORT;
const BUILD_ENTRY = path.resolve(process.cwd(), 'build/index.js');
const MAILPIT_IMAGE = 'axllent/mailpit:v1.27';

/**
 * Seeds the published fixture report with a NULL owner. The app's boot inheritance
 * (`inheritLegacyOwnership`) then backfills it to the implicit author, which in
 * multi mode is keyed on `INITIAL_OWNER_EMAIL` - so the owner who later signs in by
 * magic link (`owner@example.com`) finds this report in their tenancy view. This
 * mirrors the single-mode seed (migrate-then-insert) and reuses the same fixture.
 */
async function seedFixture(databaseUrl: string): Promise<void> {
	const pool = new pg.Pool({ connectionString: databaseUrl });
	try {
		const db = drizzle(pool);
		await migrate(db, { migrationsFolder: path.resolve(process.cwd(), 'drizzle') });

		const result = validateDocument(FIXTURE_DOCUMENT);
		if (!result.ok) {
			throw new Error(`multi e2e fixture is invalid: ${JSON.stringify(result.errors.slice(0, 3))}`);
		}
		const now = new Date();
		await db.insert(reports).values({
			id: FIXTURE_REPORT_ID,
			title: result.document.title,
			status: 'published',
			schemaVersion: result.document.version,
			document: result.document,
			publishedDocument: result.document,
			publishedAt: now,
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
			// The app boots with ADDRESS_HEADER=x-forwarded-for, so adapter-node
			// REQUIRES the header on every request (it throws on a missing one). The
			// health poll therefore sends a loopback value.
			const response = await fetch(`http://localhost:${PORT}/healthz`, {
				headers: { 'x-forwarded-for': '127.0.0.1' }
			});
			if (response.ok) return;
		} catch {
			// server not up yet
		}
		await new Promise((resolve) => setTimeout(resolve, 300));
	}
	throw new Error(`multi e2e server did not become healthy within ${timeoutMs}ms`);
}

/**
 * Playwright globalSetup for the multi-mode project: start Postgres + Mailpit, seed
 * the fixture, then boot `node build` with multi-mode env and wait for /healthz.
 * Returns a teardown that stops the server and both containers.
 */
export default async function multiGlobalSetup(): Promise<() => Promise<void>> {
	const postgres = await new PostgreSqlContainer('postgres:17-alpine')
		.withDatabase('acta_e2e_multi')
		.withUsername('acta')
		.withPassword('acta')
		.start();

	let mailpit: StartedTestContainer;
	try {
		mailpit = await new GenericContainer(MAILPIT_IMAGE)
			.withExposedPorts(1025, 8025)
			// Mailpit logs "accessible via [...]" once both listeners are up.
			.withWaitStrategy(Wait.forListeningPorts())
			.start();
	} catch (error) {
		await postgres.stop();
		throw error;
	}

	const databaseUrl = postgres.getConnectionUri();
	const smtpHost = mailpit.getHost();
	const smtpPort = mailpit.getMappedPort(1025);
	const mailpitApiUrl = `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}`;

	try {
		await seedFixture(databaseUrl);
	} catch (error) {
		await mailpit.stop();
		await postgres.stop();
		throw error;
	}

	// Hand the ephemeral container coordinates to the specs via the gitignored
	// `.auth` dir: the DB URL (a direct DB seam if needed) and the Mailpit API base
	// URL (so the mailbox helper polls without importing the container).
	mkdirSync(path.dirname(MULTI_DB_URL_FILE), { recursive: true });
	writeFileSync(MULTI_DB_URL_FILE, databaseUrl, 'utf8');
	writeFileSync(MAILPIT_URL_FILE, mailpitApiUrl, 'utf8');

	const server: ChildProcess = spawn(process.execPath, [BUILD_ENTRY], {
		stdio: 'inherit',
		env: {
			...process.env,
			NODE_ENV: 'production',
			PORT: String(PORT),
			ORIGIN: `http://localhost:${PORT}`,
			LOG_LEVEL: 'warn',
			DATABASE_URL: databaseUrl,
			// Resolve the client address from X-Forwarded-For so each test actor
			// (which sets a distinct forwarded IP, see multi-auth.ts) lands in its own
			// per-IP rate-limit bucket. XFF_DEPTH=1 reads the rightmost (closest) entry.
			// This is the adapter-node proxy-address feature; the IP-independent global
			// brakes still apply, so the limiter is not weakened, only de-collapsed from
			// the harness's single egress IP.
			ADDRESS_HEADER: 'x-forwarded-for',
			XFF_DEPTH: '1',
			// test-only; never a production secret
			SESSION_SECRET: 'e2e-multi-session-secret-at-least-32-characters-long',
			// A valid argon2id-shaped hash so the env schema passes; the password path
			// is DISABLED in multi mode, so this hash is never actually verified.
			AUTHOR_PASSWORD_HASH:
				'$argon2id$v=19$m=65536,t=3,p=4$ZTJlbXVsdGloYXJuZXNzc2FsdA$0000000000000000000000000000000000000000000',
			// The SMTP block resolves the instance to MULTI mode. Mailpit listens on
			// 1025 with no auth and no TLS, so SMTP_TLS_MODE=none and no user/password.
			SMTP_HOST: smtpHost,
			SMTP_PORT: String(smtpPort),
			SMTP_FROM: 'reports@example.com',
			SMTP_TLS_MODE: 'none',
			// Multi-mode identity (story 8.1): the owner sits inside the author domain
			// so they can authenticate; the reader whitelist is a DISTINCT domain so the
			// allow-list path (story 8.5) is exercised end to end.
			AUTHOR_EMAIL_DOMAIN: E2E_AUTHOR_EMAIL_DOMAIN,
			INITIAL_OWNER_EMAIL: E2E_INITIAL_OWNER_EMAIL,
			READER_EMAIL_DOMAINS: E2E_READER_EMAIL_DOMAIN
		}
	});

	try {
		await waitForHealth(45_000);
	} catch (error) {
		server.kill();
		await mailpit.stop();
		await postgres.stop();
		throw error;
	}

	return async () => {
		server.kill();
		await mailpit.stop();
		await postgres.stop();
	};
}
