import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

// Author-realm guard: every route in the (workspace) group requires a live
// author session (resolved by the authorRealm hook).
export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.authorSession) redirect(303, '/login');
};
