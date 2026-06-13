import { isRedirect, type ActionFailure } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setAuthorCookie } from '$lib/server/auth/cookies';
import { verifyAuthorPassword } from '$lib/server/auth/password';
import { GLOBAL_LOGIN_FAILURE_KEY, loginFailureLimiter } from '$lib/server/auth/rate-limit';
import { createAuthorSession } from '$lib/server/auth/sessions';
import { requestAuthorSignIn } from '$lib/server/auth/author-gate';
import { actions, load } from './+page.server';

// The mode is mocked so single/multi is deterministic, independent of the test
// env's SMTP config; the gate, password, and session collaborators are mocked too.
const modeState = vi.hoisted(() => ({ multi: false }));
vi.mock('$lib/server/mode', () => ({
	operatingMode: () => (modeState.multi ? 'multi' : 'single'),
	isMultiAuthor: () => modeState.multi
}));

vi.mock('$lib/server/auth/cookies', () => ({ setAuthorCookie: vi.fn() }));
vi.mock('$lib/server/auth/password', () => ({ verifyAuthorPassword: vi.fn() }));
vi.mock('$lib/server/auth/rate-limit', () => ({
	GLOBAL_LOGIN_FAILURE_KEY: 'global:/login',
	GLOBAL_AUTHOR_VERIFICATION_KEY: 'global:/login/author-verify',
	loginFailureLimiter: { consume: vi.fn() },
	authorVerificationRateLimiter: { consume: vi.fn(() => ({ allowed: true })) },
	authorVerificationFailureLimiter: { consume: vi.fn(() => ({ allowed: true })) }
}));
vi.mock('$lib/server/auth/sessions', () => ({ createAuthorSession: vi.fn() }));
vi.mock('$lib/server/auth/author-gate', () => ({ requestAuthorSignIn: vi.fn() }));

const verify = vi.mocked(verifyAuthorPassword);
const createSession = vi.mocked(createAuthorSession);
const setCookie = vi.mocked(setAuthorCookie);
const consumeGlobalFailure = vi.mocked(loginFailureLimiter.consume);
const requestSignIn = vi.mocked(requestAuthorSignIn);

function loginRequest(fields: Record<string, string>): Request {
	const body = new FormData();
	for (const [name, value] of Object.entries(fields)) body.append(name, value);
	return new Request('http://localhost:3000/login', { method: 'POST', body });
}

async function callAction(fields: Record<string, string>) {
	return await actions.password({
		request: loginRequest(fields),
		cookies: {}
	} as Parameters<typeof actions.password>[0]);
}

function requestSignInEvent(fields: Record<string, string>) {
	return {
		request: loginRequest(fields),
		locals: { requestId: 'req-1' },
		url: new URL('http://localhost:3000/login'),
		getClientAddress: () => '203.0.113.7'
	} as Parameters<(typeof actions)['request-sign-in']>[0];
}

beforeEach(() => {
	modeState.multi = false;
	vi.clearAllMocks();
	createSession.mockResolvedValue({ token: 'sess', expiresAt: new Date() });
	requestSignIn.mockResolvedValue(undefined);
});

describe('login load', () => {
	it('redirects an already-authenticated author to /reports', async () => {
		try {
			await load({
				locals: {
					requestId: 'test',
					authorSession: {
						id: '01970000-0000-7000-8000-000000000000',
						authorId: null,
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

	it('returns the single mode flag for unauthenticated visitors', async () => {
		modeState.multi = false;
		await expect(
			load({ locals: { requestId: 'test', authorSession: null } } as Parameters<typeof load>[0])
		).resolves.toEqual({ multi: false });
	});

	it('returns the multi mode flag for unauthenticated visitors', async () => {
		modeState.multi = true;
		await expect(
			load({ locals: { requestId: 'test', authorSession: null } } as Parameters<typeof load>[0])
		).resolves.toEqual({ multi: true });
	});
});

describe('password login DISABLED in multi mode', () => {
	it('refuses a password attempt with 403 and never checks the hash', async () => {
		modeState.multi = true;
		const result = (await callAction({ password: 'whatever' })) as ActionFailure<{
			message: string;
		}>;

		expect(result.status).toBe(403);
		expect(verify).not.toHaveBeenCalled();
		expect(createSession).not.toHaveBeenCalled();
	});
});

describe('request-sign-in action (multi mode magic link)', () => {
	it('returns the neutral sent state for a well-shaped email', async () => {
		modeState.multi = true;
		const result = await actions['request-sign-in'](
			requestSignInEvent({ email: 'author@example.com' })
		);
		expect(result).toEqual({ state: 'sent' });
		expect(requestSignIn).toHaveBeenCalledOnce();
	});

	it('returns the SAME neutral sent state for an unknown email (enumeration-safe)', async () => {
		modeState.multi = true;
		const result = await actions['request-sign-in'](
			requestSignInEvent({ email: 'outsider@other.com' })
		);
		expect(result).toEqual({ state: 'sent' });
	});

	it('fails 400 (form-shape) on a malformed email and issues nothing', async () => {
		modeState.multi = true;
		const result = (await actions['request-sign-in'](
			requestSignInEvent({ email: 'not-an-email' })
		)) as ActionFailure<{ state: string }>;
		expect(result.status).toBe(400);
		expect(requestSignIn).not.toHaveBeenCalled();
	});

	it('swallows a pre-send failure - the author still sees the neutral state', async () => {
		modeState.multi = true;
		requestSignIn.mockRejectedValue(new Error('db down'));
		const result = await actions['request-sign-in'](
			requestSignInEvent({ email: 'author@example.com' })
		);
		expect(result).toEqual({ state: 'sent' });
	});

	it('is inert in single mode: neutral state, issues nothing', async () => {
		modeState.multi = false;
		const result = await actions['request-sign-in'](
			requestSignInEvent({ email: 'author@example.com' })
		);
		expect(result).toEqual({ state: 'sent' });
		expect(requestSignIn).not.toHaveBeenCalled();
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
