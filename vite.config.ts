import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			// CSRF defense in depth. This list MUST stay empty. An empty
			// trustedOrigins is SvelteKit 2.x's secure default: every cross-site
			// form-POST has its Origin checked against the server origin, with no
			// third-party exemption. Realm cookies are SameSite=Lax + `__Host-`-
			// prefixed (first CSRF line); this Origin check is the second. Pinning it
			// explicitly (no behavior change) stops a future proxy workaround from
			// silently adding a trusted origin or `*` and exposing every author
			// mutation to CSRF. An ORIGIN/forwarded-header mismatch must be fixed at
			// the reverse proxy (set ORIGIN / X-Forwarded-* correctly), never by
			// trusting cross-site origins here. (The deprecated equivalent was
			// `checkOrigin: true`.)
			csrf: { trustedOrigins: [] },
			// Strict CSP (D7): zero third-party assets. Fonts are self-hosted via
			// Fontsource (bundled into the build), so no font/style/script origin
			// other than 'self' is permitted. SvelteKit hashes its own inline
			// hydration scripts and styles; nonce/hash injection is automatic in
			// `auto` mode. No external connect/img/font is allowed - the renderer
			// never phones home (images resolve to local asset paths in Epic 2).
			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
					'style-src': ['self', 'unsafe-inline'],
					'font-src': ['self'],
					'img-src': ['self', 'data:'],
					'connect-src': ['self'],
					'base-uri': ['self'],
					'object-src': ['none'],
					'frame-ancestors': ['self']
				}
			}
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
