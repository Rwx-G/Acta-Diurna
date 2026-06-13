import { beforeEach, describe, expect, it, vi } from 'vitest';

// resolveAuthorScope turns the request context into the owner scope. The mode
// decides whether the session/PAT author id is honored (multi) or ignored in
// favor of the single implicit author (single). The implicit author id and the
// mode are mocked so this is a pure routing test (story 8.3 threading).

const modeState = vi.hoisted(() => ({ multi: false }));
vi.mock('$lib/server/mode', () => ({
	operatingMode: () => (modeState.multi ? 'multi' : 'single'),
	isMultiAuthor: () => modeState.multi
}));

const mocks = vi.hoisted(() => ({ implicitAuthorId: vi.fn() }));
vi.mock('./identity', () => ({ implicitAuthorId: mocks.implicitAuthorId }));

import { resolveApiAuthorScope, resolveAuthorScope } from './resolve';

const IMPLICIT = '01970000-0000-7000-8000-0000000000aa';
const LOGGED_IN = '01970000-0000-7000-8000-0000000000bb';

beforeEach(() => {
	modeState.multi = false;
	mocks.implicitAuthorId.mockReset();
	mocks.implicitAuthorId.mockResolvedValue(IMPLICIT);
});

describe('resolveAuthorScope (cookie realm)', () => {
	it('single mode: always the implicit author, the session author id is ignored', async () => {
		modeState.multi = false;
		await expect(resolveAuthorScope(LOGGED_IN)).resolves.toEqual({ authorId: IMPLICIT });
	});

	it('multi mode: the session author id is the scope (the real logged-in author)', async () => {
		modeState.multi = true;
		await expect(resolveAuthorScope(LOGGED_IN)).resolves.toEqual({ authorId: LOGGED_IN });
	});

	it('multi mode with a null/absent author id: falls back to the implicit author (defensive)', async () => {
		modeState.multi = true;
		await expect(resolveAuthorScope(null)).resolves.toEqual({ authorId: IMPLICIT });
		await expect(resolveAuthorScope(undefined)).resolves.toEqual({ authorId: IMPLICIT });
	});
});

describe('resolveApiAuthorScope (PAT realm)', () => {
	it('uses the token owner when the PAT carries one', async () => {
		await expect(resolveApiAuthorScope({ ownerId: LOGGED_IN } as never)).resolves.toEqual({
			authorId: LOGGED_IN
		});
	});

	it('falls back to the implicit author when the PAT has no owner', async () => {
		await expect(resolveApiAuthorScope({ ownerId: null } as never)).resolves.toEqual({
			authorId: IMPLICIT
		});
	});
});
