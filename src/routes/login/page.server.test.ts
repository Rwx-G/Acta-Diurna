import { isRedirect, type ActionFailure } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setAuthorCookie } from '$lib/server/auth/cookies';
import { verifyAuthorPassword } from '$lib/server/auth/password';
import { GLOBAL_LOGIN_FAILURE_KEY, loginFailureLimiter } from '$lib/server/auth/rate-limit';
import { createAuthorSession } from '$lib/server/auth/sessions';
import { actions, load } from './+page.server';

vi.mock('$lib/server/auth/cookies', () => ({ setAuthorCookie: vi.fn() }));
vi.mock('$lib/server/auth/password', () => ({ verifyAuthorPassword: vi.fn() }));
vi.mock('$lib/server/auth/rate-limit', () => ({
	GLOBAL_LOGIN_FAILURE_KEY: 'global:/login',
	loginFailureLimiter: { consume: vi.fn() }
}));
vi.mock('$lib/server/auth/sessions', () => ({ createAuthorSession: vi.fn() }));

const verify = vi.mocked(verifyAuthorPassword);
const createSession = vi.mocked(createAuthorSession);
const setCookie = vi.mocked(setAuthorCookie);
const consumeGlobalFailure = vi.mocked(loginFailureLimiter.consume);

function loginRequest(fields: Record<string, string>): Request {
	const body = new FormData();
	for (const [name, value] of Object.entries(fields)) body.append(name, value);
	return new Request('http://localhost:3000/login', { method: 'POST', body });
}

async function callAction(fields: Record<string, string>) {
	return await actions.default({
		request: loginRequest(fields),
		cookies: {}
	} as Parameters<typeof actions.default>[0]);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('login load', () => {
	it('redirects an already-authenticated author to /reports', async () => {
		try {
			await load({
				locals: {
					requestId: 'test',
					authorSession: {
						id: '01970000-0000-7000-8000-000000000000',
						createdAt: new Date(),
						expiresAt: new Date(Date.now() + 60_000)
					}
				}
			} as Parameters<typeof load>[0]);
			expect.unreachable('load must redirect');
		} catch (thrown) {
			expect(isRedirect(thrown) && thrown.location === '/reports').toBe(true);
		}
	});

	it('renders the form for unauthenticated visitors', async () => {
		await expect(
			load({ locals: { requestId: 'test', authorSession: null } } as Parameters<typeof load>[0])
		).resolves.toBeUndefined();
	});
});

describe('login action', () => {
	it('fails 401 with the uniform message on a wrong password', async () => {
		verify.mockResolvedValueOnce(false);

		const result = (await callAction({ password: 'wrong' })) as ActionFailure<{
			message: string;
		}>;

		expect(result.status).toBe(401);
		expect(result.data).toEqual({ message: 'Invalid credentials' });
		expect(createSession).not.toHaveBeenCalled();
		expect(setCookie).not.toHaveBeenCalled();
	});

	it('consumes the global failure brake on every failed attempt', async () => {
		verify.mockResolvedValue(false);

		await callAction({ password: 'wrong-1' });
		await callAction({ password: 'wrong-2' });

		expect(consumeGlobalFailure).toHaveBeenCalledTimes(2);
		expect(consumeGlobalFailure).toHaveBeenCalledWith(GLOBAL_LOGIN_FAILURE_KEY);
	});

	it('still runs one argon2 verification when the field is missing (uniform timing)', async () => {
		verify.mockResolvedValueOnce(false);

		const result = (await callAction({})) as ActionFailure<{ message: string }>;

		expect(verify).toHaveBeenCalledExactlyOnceWith('');
		expect(result.status).toBe(401);
		expect(result.data).toEqual({ message: 'Invalid credentials' });
	});

	it('creates a session, sets the cookie and redirects on success', async () => {
		const expiresAt = new Date(Date.now() + 60_000);
		verify.mockResolvedValueOnce(true);
		createSession.mockResolvedValueOnce({ token: 'fresh-token', expiresAt });

		try {
			await callAction({ password: 'correct' });
			expect.unreachable('action must redirect');
		} catch (thrown) {
			expect(isRedirect(thrown) && thrown.status === 303 && thrown.location === '/reports').toBe(
				true
			);
		}
		expect(setCookie).toHaveBeenCalledWith({}, 'fresh-token', expiresAt);
		// Successful logins never feed the global brake.
		expect(consumeGlobalFailure).not.toHaveBeenCalled();
	});
});
