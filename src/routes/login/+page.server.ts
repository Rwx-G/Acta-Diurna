import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { requestAuthorSignIn } from '$lib/server/auth/author-gate';
import { setAuthorCookie } from '$lib/server/auth/cookies';
import { verifyAuthorPassword } from '$lib/server/auth/password';
import {
	authorVerificationFailureLimiter,
	authorVerificationRateLimiter,
	GLOBAL_AUTHOR_VERIFICATION_KEY,
	GLOBAL_LOGIN_FAILURE_KEY,
	loginFailureLimiter
} from '$lib/server/auth/rate-limit';
import { createAuthorSession } from '$lib/server/auth/sessions';
import { isMultiAuthor } from '$lib/server/mode';
import { isPlausibleEmail, normalizeEmail } from '$lib/server/reader';

/**
 * Mode-aware author login (Epic 8, story 8.3). One source of truth - `isMultiAuthor`
 * - decides the path:
 *
 *  - SINGLE mode: the password action is byte-identical to today (no email path,
 *    no magic link). The `password` action verifies the password.
 *  - MULTI mode: the password login is DISABLED (the password field is absent and
 *    the `password` action refuses), and the magic-link path is the only author
 *    entry: the `request-sign-in` action mails a single-use link to an in-domain
 *    email and ALWAYS returns the same neutral confirmation (enumeration-safe).
 *
 * The page (`+page.svelte`) renders the email field in multi mode and the password
 * field in single mode off the `multi` flag this load returns (story 8.6 polishes
 * the UX; the field/action split is already correct here).
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (locals.authorSession) redirect(303, '/reports');
	return { multi: isMultiAuthor() };
};

// Both actions are NAMED (`password`, `request-sign-in`): SvelteKit forbids a
// `default` action coexisting with named ones, so the single-mode password path
// posts to `?/password` and the multi-mode magic-link path to `?/request-sign-in`.
export const actions: Actions = {
	/**
	 * Password sign-in (single mode only). In multi mode it REFUSES: the password
	 * login is disabled, so a posted password never authenticates - magic link is
	 * the only author path. The refusal is a plain failure, not a credential check
	 * (no argon2 work, no oracle), because there is structurally no password author
	 * in multi mode.
	 */
	password: async ({ request, cookies }) => {
		if (isMultiAuthor()) {
			// Password login is disabled in multi mode (story 8.3 AC). Refuse without
			// touching the password hash - there is no password author here.
			return fail(403, { message: 'Password sign-in is disabled. Use the email sign-in link.' });
		}

		const data = await request.formData();
		const field = data.get('password');
		// A missing field verifies against the empty string so every failure
		// path runs exactly one argon2 verification (uniform timing, NFR9).
		const password = typeof field === 'string' ? field : '';

		if (!(await verifyAuthorPassword(password))) {
			// Only failures feed the global brake (checked by the hook): total
			// guessing stays bounded while legitimate logins cost nothing.
			loginFailureLimiter.consume(GLOBAL_LOGIN_FAILURE_KEY);
			// Single failure message regardless of cause: no information leak.
			return fail(401, { message: 'Invalid credentials' });
		}

		// Single-mode password session carries no per-author id (the implicit author
		// owns everything); the column stays null and resolveAuthorScope falls back.
		const { token, expiresAt } = await createAuthorSession();
		setAuthorCookie(cookies, token, expiresAt);
		redirect(303, '/reports');
	},

	/**
	 * Magic-link request (multi mode only). Submits an email; mails a single-use
	 * sign-in link to an in-domain address and ALWAYS returns the same neutral
	 * confirmation. In single mode this action is inert (no magic link), returning
	 * the same neutral state without doing anything, so a stray post cannot probe.
	 */
	'request-sign-in': async (event) => requestSignInAction(event)
};

/**
 * Email-submission action (multi mode). Rate-limited per-IP plus the global brake.
 * The response is IDENTICAL whether the email is an authorized author, off-domain,
 * or unknown - the only failure surfaced is a malformed email shape (a client-side
 * input error, not an authorization signal). A mail-delivery failure is NOT
 * surfaced (it would reveal an attempt was made for a real recipient); it is logged
 * inside `requestAuthorSignIn` and swallowed here so the author always sees the same
 * neutral confirmation (NFR9).
 */
async function requestSignInAction(event: RequestEvent) {
	const { request, locals, url, getClientAddress } = event;

	// Single mode has no magic-link path: return the neutral state without issuing
	// anything, so the action is inert and reveals nothing.
	if (!isMultiAuthor()) return { state: 'sent' as const };

	// Per-IP bucket first, on every submission, so a single IP is always bounded.
	if (!authorVerificationRateLimiter.consume(`${getClientAddress()}:/login`).allowed) {
		return fail(429, { state: 'throttled' as const });
	}

	const data = await request.formData();
	const field = data.get('email');
	const email = typeof field === 'string' ? normalizeEmail(field) : '';
	if (!isPlausibleEmail(email)) {
		// A shape error is a form-validation problem, not an enumeration signal: it
		// tells the author to fix their own typo, not whether they are allowed. NOT a
		// genuine attempt, so the global brake is left untouched.
		return fail(400, { state: 'invalid' as const });
	}

	// Global brake consumed only once a genuine attempt is established (a
	// plausibly-shaped email), so spamming malformed submissions cannot drain it.
	if (!authorVerificationFailureLimiter.consume(GLOBAL_AUTHOR_VERIFICATION_KEY).allowed) {
		return fail(429, { state: 'throttled' as const });
	}

	const signInUrlFor = (rawToken: string): string => `${url.origin}/login/verify?t=${rawToken}`;

	// The domain check lives INSIDE requestAuthorSignIn, BEHIND this same neutral
	// return - an off-domain email silently gets no link, but the author sees the
	// identical confirmation (NFR9). The send is fire-and-forget inside the gate, so
	// neither path waits on SMTP; any pre-send error (DB) is swallowed here so the
	// author always sees the same neutral state.
	try {
		await requestAuthorSignIn(email, signInUrlFor, locals.requestId);
	} catch {
		// A pre-send failure is never surfaced - surfacing it would reveal that work
		// was attempted for this address. The author always sees the neutral state.
	}

	return { state: 'sent' as const };
}
