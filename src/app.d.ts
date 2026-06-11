// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
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
		}
	}
}

export {};
