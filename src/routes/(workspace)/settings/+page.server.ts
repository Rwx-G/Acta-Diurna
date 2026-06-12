import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { performLogout } from '$lib/server/auth/logout';
import { mailerConfig } from '$lib/server/mail/mailer';
import { sendMail } from '$lib/server/mail/send';
import { testEmail } from '$lib/server/mail/templates/test-email';
import { AppError } from '$lib/server/problem';

// Surfaces whether SMTP is configured so the page can explain the absent case
// instead of offering a test-send that always 503s. The address itself is not
// secret; the password is never read here.
export const load: PageServerLoad = async () => {
	const config = mailerConfig();
	return {
		smtp: config ? { configured: true as const, from: config.from, tlsMode: config.tlsMode } : null
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
	logout: async ({ cookies }) => {
		await performLogout(cookies);
		redirect(303, '/login');
	}
};
