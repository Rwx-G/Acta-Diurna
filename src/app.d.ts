// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { ApiIdentity } from '$lib/server/auth/api-tokens';
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
			// Resolved by the apiAuth hook on /api/* requests ONLY (the programmatic
			// PAT-bearer realm): the authenticated token identity, or null. A cookie
			// never populates this; a PAT never populates authorSession. 4.2/4.3
			// endpoints read locals.apiIdentity for the authenticated author.
			apiIdentity: ApiIdentity | null;
		}
	}
}

export {};
