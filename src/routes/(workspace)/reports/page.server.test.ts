import { isRedirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteAuthorCookie, readAuthorCookie } from '$lib/server/auth/cookies';
import { destroySession } from '$lib/server/auth/sessions';
import { actions } from './+page.server';

vi.mock('$lib/server/auth/cookies', () => ({
	readAuthorCookie: vi.fn(),
	deleteAuthorCookie: vi.fn()
}));
vi.mock('$lib/server/auth/sessions', () => ({ destroySession: vi.fn() }));

const readCookie = vi.mocked(readAuthorCookie);
const deleteCookie = vi.mocked(deleteAuthorCookie);
const destroy = vi.mocked(destroySession);

async function callLogout() {
	try {
		await actions.logout({ cookies: {} } as Parameters<typeof actions.logout>[0]);
		expect.unreachable('logout must redirect');
	} catch (thrown) {
		expect(isRedirect(thrown) && thrown.status === 303 && thrown.location === '/login').toBe(true);
	}
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('logout action', () => {
	it('destroys the session, clears the cookie and redirects to /login', async () => {
		readCookie.mockReturnValueOnce('live-token');

		await callLogout();

		expect(destroy).toHaveBeenCalledExactlyOnceWith('live-token');
		expect(deleteCookie).toHaveBeenCalledTimes(1);
	});

	it('still clears the cookie and redirects when no valid cookie is present', async () => {
		readCookie.mockReturnValueOnce(null);

		await callLogout();

		expect(destroy).not.toHaveBeenCalled();
		expect(deleteCookie).toHaveBeenCalledTimes(1);
	});
});
