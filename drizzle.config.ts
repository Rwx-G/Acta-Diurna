import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	dialect: 'postgresql',
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dbCredentials: {
		// Only needed by drizzle-kit commands that touch a live database
		// (push, migrate, studio); `generate` works without it.
		url: process.env.DATABASE_URL ?? ''
	}
});
