import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { performLogout } from '$lib/server/auth/logout';

// The workspace root is the reports list (1.5); `/` just forwards there.
export const load: PageServerLoad = async () => {
	redirect(303, '/reports');
};

export const actions: Actions = {
	logout: async ({ cookies }) => {
		await performLogout(cookies);
		redirect(303, '/login');
	}
};
