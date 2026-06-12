import type { Cookies } from '@sveltejs/kit';
import { deleteAuthorCookie, readAuthorCookie } from './cookies';
import { destroySession } from './sessions';

/**
 * Destroys the current author session (if the cookie verifies) and clears the
 * cookie. Shared by every workspace page's logout action: SvelteKit actions
 * are per-page, the logic lives once here.
 */
export async function performLogout(cookies: Cookies): Promise<void> {
	const token = readAuthorCookie(cookies);
	if (token) await destroySession(token);
	deleteAuthorCookie(cookies);
}
