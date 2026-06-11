import { defineConfig } from '@playwright/test';

// No webServer block yet: the boot sequence (story 1.3) validates env and runs
// database migrations before serving, so `vite preview` needs a live Postgres.
// The first e2e story must reintroduce webServer together with a database
// fixture (e.g. the compose stack) and the env it requires.
export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/*.e2e.{ts,js}'
});
