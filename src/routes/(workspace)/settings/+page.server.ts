import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createApiToken, listApiTokens, revokeApiToken } from '$lib/server/auth/api-tokens';
import { performLogout } from '$lib/server/auth/logout';
import { mailerConfig } from '$lib/server/mail/mailer';
import { sendMail } from '$lib/server/mail/send';
import { testEmail } from '$lib/server/mail/templates/test-email';
import { AppError } from '$lib/server/problem';

// Surfaces whether SMTP is configured so the page can explain the absent case
// instead of offering a test-send that always 503s. The address itself is not
// secret; the password is never read here. Also lists the author's API tokens
// (D10) - id/name/fragment/timestamps/status only, never the raw token or hash.
export const load: PageServerLoad = async () => {
	const config = mailerConfig();
	return {
		smtp: config ? { configured: true as const, from: config.from, tlsMode: config.tlsMode } : null,
		tokens: await listApiTokens()
	};
};

// Minimal address shape check: the relay is the real validator, this only
// rejects an empty or obviously malformed entry before a pointless round-trip.
function isEmailLike(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export const actions: Actions = {
	// FR36 / NFR16: send a test message and report success or the exact, redacted
	// failure inline. A delivery failure is a first-class returned state, never a
	// silent drop - the AppError detail (already redacted of host/credentials) is
	// handed to the page.
	'test-send': async ({ request, locals }) => {
		const data = await request.formData();
		const to = data.get('to');
		if (typeof to !== 'string' || !isEmailLike(to.trim())) {
			return fail(400, { sent: false, message: 'Enter a valid email address.' });
		}

		try {
			const result = await sendMail(testEmail(to.trim()), locals.requestId);
			return {
				sent: true,
				message: `Test email sent to ${to.trim()}.`,
				messageId: result.messageId
			};
		} catch (thrown) {
			if (thrown instanceof AppError) {
				return fail(thrown.status, { sent: false, message: thrown.detail ?? thrown.title });
			}
			throw thrown;
		}
	},
	// D10: mint a personal access token. The raw token is returned ONCE on this
	// action result (shown once in the UI, never re-fetchable, never logged); only
	// its hash is stored. A reload loses the raw token, by design.
	'create-token': async ({ request }) => {
		const data = await request.formData();
		const name = data.get('name');
		if (typeof name !== 'string' || name.trim().length === 0) {
			return fail(400, {
				token: { created: false as const, message: 'Enter a name for the token.' }
			});
		}
		const { token, summary } = await createApiToken(name.trim());
		return { token: { created: true as const, raw: token, name: summary.name } };
	},
	// D10: revoke a token (idempotent). The list reloads showing the revoked chip.
	'revoke-token': async ({ request }) => {
		const data = await request.formData();
		const id = data.get('tokenId');
		if (typeof id !== 'string' || id.length === 0) {
			return fail(400, { token: { created: false as const, message: 'Missing token id.' } });
		}
		await revokeApiToken(id);
		return { token: { revoked: true as const } };
	},
	logout: async ({ cookies }) => {
		await performLogout(cookies);
		redirect(303, '/login');
	}
};
