import { defineConfig, devices } from '@playwright/test';
import { AUTH_STATE } from './e2e/fixtures.ts';

// e2e harness (story 1.6, the readiness decision): an ephemeral Postgres
// testcontainer backs a real `node build` server with boot migrations and a
// seeded fixture report.
//
// globalSetup owns the whole lifecycle in one place and one process: it starts
// the container, migrates, seeds the fixture, then spawns `node build` against
// it and waits for /healthz before returning. This sidesteps Playwright's
// "webServer starts before globalSetup" ordering (which broke env injection)
// and guarantees the container is started exactly once. globalSetup returns a
// teardown that stops the server and the container. `--pass-with-no-tests` is
// gone: CI now runs real specs.
//
// Requires Docker (GitHub Actions runners provide it). When Docker is
// unavailable globalSetup throws and the suite fails loudly, never silently
// passing.
const PORT = 4173;

export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/*.{e2e,setup}.{ts,js}',
	// The multi-mode harness lives in its OWN config (playwright.multi.config.ts)
	// with its own global setup, containers, and app port. Exclude its specs AND its
	// setup here so the single-mode setup/desktop/mobile projects never pick them up
	// and the 17 green single-mode specs stay byte-identical.
	testIgnore: ['**/multi-*.e2e.ts', '**/multi-*.setup.ts'],
	globalSetup: './e2e/global-setup.ts',
	timeout: 30_000,
	expect: { timeout: 10_000 },
	fullyParallel: false,
	workers: 1,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: 'on-first-retry'
	},
	projects: [
		{ name: 'setup', testMatch: /.*\.setup\.ts/ },
		{
			name: 'desktop',
			use: { ...devices['Desktop Chrome'], storageState: AUTH_STATE },
			dependencies: ['setup']
		},
		{
			name: 'mobile',
			use: { ...devices['Pixel 7'], storageState: AUTH_STATE },
			dependencies: ['setup']
		}
	]
});
