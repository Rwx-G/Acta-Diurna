import { defineConfig, devices } from '@playwright/test';
import { E2E_MULTI_PORT } from './e2e/fixtures.ts';

// MULTI-mode e2e config, deliberately SEPARATE from the single-mode
// `playwright.config.ts`. The two harnesses are fully isolated: each config owns
// its own globalSetup, its own Postgres (+ here, Mailpit) testcontainers, and its
// own app port, so neither leaks state into the other. Splitting at the config
// level (rather than adding a project to the single-mode config) keeps the
// single-mode `setup`/desktop/mobile projects byte-identical - the 17 green specs
// never see this harness, and this harness never boots the password-mode server.
//
// The multi-mode flows (author magic-link sign-in, tenancy isolation, reader
// verification, reader whitelist) are workspace/reader flows that exercise one
// desktop browser against the real Mailpit + Postgres stack, so a single
// `multi-desktop` project is enough (no mobile variant - none of these assert a
// mobile-specific surface).
const PORT = E2E_MULTI_PORT;

export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/multi-*.{e2e,setup}.ts',
	globalSetup: './e2e/multi-global-setup.ts',
	// Each magic-link step polls Mailpit with a short bounded wait; per-actor
	// forwarded IPs (see multi-auth.ts) keep the rate limiter from ever throttling,
	// so no refill waits are needed and a slightly-higher-than-single-mode ceiling
	// covers the two-hop sign-in (submission + landing) comfortably.
	timeout: 45_000,
	expect: { timeout: 10_000 },
	fullyParallel: false,
	workers: 1,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: 'on-first-retry'
	},
	projects: [
		// Signs owner/alice/bob in once and saves their storage states (session
		// reuse, to stay under the per-IP author-verification burst). The test
		// project depends on it; specs opt into a saved state with `test.use`.
		{ name: 'multi-setup', testMatch: /multi-auth\.setup\.ts/ },
		{
			name: 'multi-desktop',
			testMatch: /multi-.*\.e2e\.ts/,
			// No global storageState: the sign-in spec runs UNAUTHENTICATED (it tests
			// the login page), and the other specs build per-actor contexts (each with
			// its own forwarded IP) via `actorContext`.
			//
			// The DEFAULT context (used only by the sign-in spec, which does not build
			// its own context) carries a fixed forwarded IP so its requests carry the
			// ADDRESS_HEADER the app requires and land in one dedicated bucket.
			use: {
				...devices['Desktop Chrome'],
				extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.200' }
			},
			dependencies: ['multi-setup']
		}
	]
});
