import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// The workspace root is the reports list (1.5); `/` just forwards there.
export const load: PageServerLoad = async () => {
	redirect(303, '/reports');
};
