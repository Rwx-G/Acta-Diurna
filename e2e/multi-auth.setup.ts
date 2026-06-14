import { test as setup } from '@playwright/test';
import { MULTI_AUTHORS } from './fixtures.ts';
import { actorContext, signInAsAuthor } from './multi-auth.ts';

// Signs each reusable multi-mode author in ONCE via the real magic-link flow and
// saves their session to storage state, which the tenancy and reader specs then
// reuse. Each author signs in from its OWN `actorContext` (a unique forwarded IP),
// so the three setup sign-ins land in three independent per-IP rate-limit buckets
// rather than draining one shared localhost bucket (see multi-auth.ts). The live
// magic-link sign-in is also covered as a behavior by `multi-author-signin.e2e.ts`
// (a distinct fresh email); this setup is just the session-reuse seam.

for (const { email, state } of Object.values(MULTI_AUTHORS)) {
	setup(`authenticate ${email}`, async ({ browser }) => {
		const context = await actorContext(browser);
		try {
			const page = await context.newPage();
			await signInAsAuthor(page, email);
			await context.storageState({ path: state });
		} finally {
			await context.close();
		}
	});
}
