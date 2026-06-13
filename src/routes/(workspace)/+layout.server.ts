import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { authorDisplayEmail } from '$lib/server/authors';
import { isMultiAuthor } from '$lib/server/mode';

/**
 * Author-realm guard plus the workspace identity (story 8.6). Every route in the
 * (workspace) group requires a live author session (resolved by the authorRealm
 * hook). In MULTI mode the layout also surfaces the logged-in author's email near
 * logout so they can see who they are signed in as; the session carries the real
 * author id (story 8.3). In SINGLE mode the password author is anonymous, so no
 * identity is shown (`authorEmail` stays null) and the nav is byte-identical to
 * today.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.authorSession) redirect(303, '/login');

	const authorId = locals.authorSession.authorId;
	const authorEmail = isMultiAuthor() && authorId ? await authorDisplayEmail(authorId) : null;

	return { authorEmail };
};
