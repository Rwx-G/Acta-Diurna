import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { setAuthorCookie } from '$lib/server/auth/cookies';
import { verifyAuthorPassword } from '$lib/server/auth/password';
import { createAuthorSession } from '$lib/server/auth/sessions';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.authorSession) redirect(303, '/reports');
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		const field = data.get('password');
		// A missing field verifies against the empty string so every failure
		// path runs exactly one argon2 verification (uniform timing, NFR9).
		const password = typeof field === 'string' ? field : '';

		if (!(await verifyAuthorPassword(password))) {
			// Single failure message regardless of cause: no information leak.
			return fail(401, { message: 'Invalid credentials' });
		}

		const { token, expiresAt } = await createAuthorSession();
		setAuthorCookie(cookies, token, expiresAt);
		redirect(303, '/reports');
	}
};
