/**
 * Shared constants for the e2e harness: the test author password (its argon2
 * hash is derived at setup time so it stays reproducible across machines/CI),
 * and the seeded fixture report (the schema full example) with a fixed id so
 * the reader-view specs can navigate to a known URL.
 */
import { fullDocument } from '../src/lib/schema/examples/full.ts';

export const E2E_PORT = 4173;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

/** Where the `setup` project saves the authenticated author storage state. */
export const AUTH_STATE = 'e2e/.auth/author.json';

export const E2E_AUTHOR_PASSWORD = 'e2e-secret-password';

/** Fixed UUIDv7 so the reader-view URL is stable across runs. */
export const FIXTURE_REPORT_ID = '0197b300-0000-7000-8000-000000000001';

export const FIXTURE_DOCUMENT = fullDocument;

/** The fixture's section ids, for deep-link assertions. */
export const FIXTURE_SECTION_IDS = [
	'executive-summary',
	'incident-analysis',
	'methodology'
] as const;
