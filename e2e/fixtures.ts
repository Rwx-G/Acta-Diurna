/**
 * Shared constants for the e2e harness: the test author password (its argon2
 * hash is derived at setup time so it stays reproducible across machines/CI), the
 * ports and auth-state paths, the seeded fixture ids, and the reader/audit
 * emails. The large per-spec document literals live in `e2e/fixtures/` (one file
 * per surface) and are re-exported here, so every spec and the seed keep
 * importing from `./fixtures.ts` unchanged.
 */
import { fullDocument } from '../src/lib/schema/examples/full.ts';

export { MATRIX_FIXTURE_DOCUMENT } from './fixtures/matrix.ts';
export { PHASE_B_FIXTURE_DOCUMENT } from './fixtures/phase-b.ts';
export { MERIDIAN_FIXTURE_DOCUMENT } from './fixtures/meridian.ts';
export { PRESENTER_FIXTURE_DOCUMENT, PRESENTER_NOTES } from './fixtures/presenter.ts';
export {
	DATA_AS_OF_FIXTURE_DOCUMENT,
	DATA_AS_OF_ISO,
	DATA_AS_OF_CAPTION
} from './fixtures/data-as-of.ts';

export const E2E_PORT = 4173;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

/**
 * Distinct port for the multi-mode harness so its `node build` server never
 * collides with the single-mode one (the two projects own separate containers and
 * separate app processes - see `multi-global-setup.ts`).
 */
export const E2E_MULTI_PORT = 4273;
export const E2E_MULTI_BASE_URL = `http://localhost:${E2E_MULTI_PORT}`;

/** Where the `setup` project saves the authenticated author storage state. */
export const AUTH_STATE = 'e2e/.auth/author.json';

/**
 * Where globalSetup writes the ephemeral testcontainer DATABASE_URL, for specs
 * that need a direct DB seam (the reader-verification spec). Gitignored with the
 * rest of `.auth/`.
 */
export const DB_URL_FILE = 'e2e/.auth/db-url.txt';

/**
 * The multi-mode harness writes its OWN container DATABASE_URL here, kept separate
 * from the single-mode `DB_URL_FILE` so the two harnesses never read each other's
 * connection string. Gitignored with the rest of `.auth/`.
 */
export const MULTI_DB_URL_FILE = 'e2e/.auth/multi-db-url.txt';

/**
 * The multi-mode harness writes the mapped Mailpit HTTP-API base URL here so a
 * spec can poll the SMTP double without importing the container (the same
 * `.auth`-file seam the DB URL uses). Gitignored with the rest of `.auth/`.
 */
export const MAILPIT_URL_FILE = 'e2e/.auth/mailpit-url.txt';

/**
 * Multi-mode identity env (story 8.1). The harness boots with SMTP set (multi
 * mode), so these MUST satisfy the fail-fast superRefine: `INITIAL_OWNER_EMAIL`
 * sits inside `AUTHOR_EMAIL_DOMAIN`, and `READER_EMAIL_DOMAINS` whitelists a
 * distinct reader domain so the allow-list path (story 8.5) is exercised end to
 * end. These are test-only literals, never production values.
 */
export const E2E_AUTHOR_EMAIL_DOMAIN = 'example.com';
export const E2E_INITIAL_OWNER_EMAIL = 'owner@example.com';
export const E2E_READER_EMAIL_DOMAIN = 'reader.example.com';

/**
 * The multi-mode authors the harness signs in ONCE (in `multi-auth.setup.ts`) and
 * reuses via saved storage state. Collapsing every author sign-in to one per author
 * keeps the run under the per-IP author-verification burst (capacity 5): all
 * requests come from one localhost IP, so re-signing in per test would throttle the
 * later flows. `owner` inherited the seeded report; `alice`/`bob` are minted on
 * their first verified sign-in (the tenancy spec proves they cannot see each other).
 */
export const MULTI_AUTHORS = {
	owner: { email: E2E_INITIAL_OWNER_EMAIL, state: 'e2e/.auth/multi-owner.json' },
	alice: { email: 'alice@example.com', state: 'e2e/.auth/multi-alice.json' },
	bob: { email: 'bob@example.com', state: 'e2e/.auth/multi-bob.json' }
} as const;

export const E2E_AUTHOR_PASSWORD = 'e2e-secret-password';

/** Fixed UUIDv7 so the reader-view URL is stable across runs. */
export const FIXTURE_REPORT_ID = '0197b300-0000-7000-8000-000000000001';

export const FIXTURE_DOCUMENT = fullDocument;

/** The correlation-blocks fixture report id (document in `fixtures/matrix.ts`). */
export const MATRIX_FIXTURE_REPORT_ID = '0197b300-0000-7000-8000-000000000002';

/** The Epic 7 Phase B fixture report id (document in `fixtures/phase-b.ts`). */
export const PHASE_B_FIXTURE_REPORT_ID = '0197b300-0000-7000-8000-000000000003';

/** The warm-meridian theme fixture report id (document in `fixtures/meridian.ts`). */
export const MERIDIAN_FIXTURE_REPORT_ID = '0197b300-0000-7000-8000-000000000006';

/**
 * Fixed ids and literals for the access-audit e2e (Story 6.3, FR24). In SINGLE
 * mode an `/r/<token>` consultation read serves the report DIRECTLY and never
 * calls `recordAccess` (only the MULTI magic-link `completeVerification` writes an
 * access row), so the audit trail cannot be produced through the single-mode HTTP
 * reader flow. The spec therefore seeds the trail through the DB seam (the same
 * `DB_URL_FILE` route `restricted-share.e2e.ts` uses for DB-only state): one
 * share on the full fixture report, one reader identity, and one access record at
 * a fixed UTC instant so the rendered "Opened" cell is byte-stable. Fixed ids let
 * the desktop and mobile project runs share the seeded rows (ON CONFLICT DO
 * NOTHING), and `accessedAt` is fixed so the formatted timestamp is deterministic.
 */
export const AUDIT_SHARE_ID = '0197b300-0000-7000-8000-0000000000a1';
export const AUDIT_READER_IDENTITY_ID = '0197b300-0000-7000-8000-0000000000a2';
export const AUDIT_ACCESS_RECORD_ID = '0197b300-0000-7000-8000-0000000000a3';
export const AUDIT_READER_EMAIL = 'audit-reader@reader.example.com';
export const AUDIT_ACCESSED_AT_ISO = '2026-06-13T14:30:00.000Z';
export const AUDIT_ACCESSED_AT_CELL = '2026-06-13 14:30 UTC';

/**
 * Fixed ids for the retention-purge integration e2e (Story 6.3, FR24/FR38/NFR11).
 * The boot sweep only fires `purgeAccessRecords` when `ACCESS_RECORD_RETENTION_DAYS`
 * is set, and the single-mode harness boots WITHOUT it (the audit trail is kept by
 * default), so the boot sweep cannot be reached in-process. The spec instead drives
 * the REAL `purgeAccessRecords(db, now, retentionDays)` against the live
 * testcontainer Postgres (via DB_URL_FILE), seeding one AGED access record (older
 * than the cutoff) and one FRESH one on a dedicated share + identity, then asserting
 * the DELETE removed only the aged row. This exercises the real end-to-end DELETE
 * the boot sweep would run, just invoked directly rather than through boot env.
 */
export const RETENTION_SHARE_ID = '0197b300-0000-7000-8000-0000000000b1';
export const RETENTION_READER_IDENTITY_ID = '0197b300-0000-7000-8000-0000000000b2';
export const RETENTION_AGED_RECORD_ID = '0197b300-0000-7000-8000-0000000000b3';
export const RETENTION_FRESH_RECORD_ID = '0197b300-0000-7000-8000-0000000000b4';
export const RETENTION_READER_EMAIL = 'retention-reader@reader.example.com';

/** The fixture's section ids, for deep-link assertions. */
export const FIXTURE_SECTION_IDS = [
	'executive-summary',
	'incident-analysis',
	'methodology'
] as const;

/** The speaker-notes fixture report id (document + notes in `fixtures/presenter.ts`). */
export const PRESENTER_FIXTURE_REPORT_ID = '0197b300-0000-7000-8000-000000000004';

/** The data-as-of caption fixture report id (document in `fixtures/data-as-of.ts`). */
export const DATA_AS_OF_FIXTURE_REPORT_ID = '0197b300-0000-7000-8000-000000000005';
