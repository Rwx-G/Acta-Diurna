import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { deleteAuthorCookie, readAuthorCookie } from '$lib/server/auth/cookies';
import { destroySession } from '$lib/server/auth/sessions';

export const actions: Actions = {
	logout: async ({ cookies }) => {
		const token = readAuthorCookie(cookies);
		if (token) await destroySession(token);
		deleteAuthorCookie(cookies);
		redirect(303, '/login');
	}
};
