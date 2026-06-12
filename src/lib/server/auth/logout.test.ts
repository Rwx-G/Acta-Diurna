import type { Cookies } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteAuthorCookie, readAuthorCookie } from './cookies';
import { performLogout } from './logout';
import { destroySession } from './sessions';

vi.mock('./cookies', () => ({
	readAuthorCookie: vi.fn(),
	deleteAuthorCookie: vi.fn()
}));
vi.mock('./sessions', () => ({ destroySession: vi.fn() }));

const readCookie = vi.mocked(readAuthorCookie);
const deleteCookie = vi.mocked(deleteAuthorCookie);
const destroy = vi.mocked(destroySession);

const cookies = {} as Cookies;

beforeEach(() => {
	vi.clearAllMocks();
});

describe('performLogout', () => {
	it('destroys the session and clears the cookie when the cookie verifies', async () => {
		readCookie.mockReturnValueOnce('live-token');

		await performLogout(cookies);

		expect(destroy).toHaveBeenCalledExactlyOnceWith('live-token');
		expect(deleteCookie).toHaveBeenCalledExactlyOnceWith(cookies);
	});

	it('still clears the cookie when no valid cookie is present', async () => {
		readCookie.mockReturnValueOnce(null);

		await performLogout(cookies);

		expect(destroy).not.toHaveBeenCalled();
		expect(deleteCookie).toHaveBeenCalledTimes(1);
	});
});
