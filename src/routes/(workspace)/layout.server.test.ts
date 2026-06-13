import { isRedirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authorDisplayEmail } from '$lib/server/authors';
import { load } from './+layout.server';

// Mode and the author lookup are mocked so single/multi is deterministic and the
// identity surfacing is asserted without a database.
const modeState = vi.hoisted(() => ({ multi: false }));
vi.mock('$lib/server/mode', () => ({ isMultiAuthor: () => modeState.multi }));
vi.mock('$lib/server/authors', () => ({ authorDisplayEmail: vi.fn() }));

const displayEmail = vi.mocked(authorDisplayEmail);

function callLoad(authorSession: App.Locals['authorSession']) {
	return load({ locals: { requestId: 'test', authorSession } } as Parameters<typeof load>[0]);
}

function session(authorId: string | null): NonNullable<App.Locals['authorSession']> {
	return {
		id: '01970000-0000-7000-8000-000000000000',
		authorId,
		createdAt: new Date(),
		expiresAt: new Date(Date.now() + 60_000)
	};
}

beforeEach(() => {
	modeState.multi = false;
	vi.clearAllMocks();
	displayEmail.mockResolvedValue(null);
});

describe('(workspace) layout guard', () => {
	it('redirects unauthenticated requests to /login', async () => {
		try {
			await callLoad(null);
			expect.unreachable('guard must redirect');
		} catch (thrown) {
			expect(isRedirect(thrown) && thrown.status === 303 && thrown.location === '/login').toBe(
				true
			);
		}
	});

	it('lets an authenticated author through', async () => {
		await expect(callLoad(session(null))).resolves.toEqual({ authorEmail: null });
	});
});

describe('(workspace) author identity surfacing', () => {
	it('surfaces the logged-in author email in multi mode', async () => {
		modeState.multi = true;
		displayEmail.mockResolvedValue('author@example.com');

		await expect(callLoad(session('01970000-0000-7000-8000-0000000000aa'))).resolves.toEqual({
			authorEmail: 'author@example.com'
		});
		expect(displayEmail).toHaveBeenCalledExactlyOnceWith('01970000-0000-7000-8000-0000000000aa');
	});

	it('shows no identity in single mode (the password author is anonymous)', async () => {
		modeState.multi = false;

		await expect(callLoad(session(null))).resolves.toEqual({ authorEmail: null });
		// Single mode never looks up an author email - no identity to surface.
		expect(displayEmail).not.toHaveBeenCalled();
	});
});
