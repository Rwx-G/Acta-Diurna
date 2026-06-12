import { isRedirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { performLogout } from '$lib/server/auth/logout';
import { actions, load } from './+page.server';

vi.mock('$lib/server/auth/logout', () => ({ performLogout: vi.fn() }));

const logout = vi.mocked(performLogout);

beforeEach(() => {
	vi.clearAllMocks();
});

describe('workspace root load', () => {
	it('forwards to /reports', async () => {
		try {
			await load({} as Parameters<typeof load>[0]);
			expect.unreachable('load must redirect');
		} catch (thrown) {
			expect(isRedirect(thrown) && thrown.status === 303 && thrown.location === '/reports').toBe(
				true
			);
		}
	});
});

describe('logout action', () => {
	it('performs the shared logout and redirects to /login', async () => {
		try {
			await actions.logout({ cookies: {} } as Parameters<typeof actions.logout>[0]);
			expect.unreachable('logout must redirect');
		} catch (thrown) {
			expect(isRedirect(thrown) && thrown.status === 303 && thrown.location === '/login').toBe(
				true
			);
		}
		expect(logout).toHaveBeenCalledExactlyOnceWith({});
	});
});
