import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { performLogout } from '$lib/server/auth/logout';

export const actions: Actions = {
	logout: async ({ cookies }) => {
		await performLogout(cookies);
		redirect(303, '/login');
	}
};
