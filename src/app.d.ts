// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { AuthorSession } from '$lib/server/auth/sessions';

declare global {
	namespace App {
		// RFC 9457 problem-details shape returned by handleError in hooks.server.ts.
		// SvelteKit's ambient App.Error also requires `message`; it stays as an
		// RFC 9457 extension member mirroring `title`.
		interface Error {
			type: string;
			title: string;
			status: number;
		}
		interface Locals {
			requestId: string;
			// Resolved by the authorRealm hook on every request: null means
			// unauthenticated (or invalid/expired cookie, already cleared).
			authorSession: AuthorSession | null;
		}
	}
}

export {};
