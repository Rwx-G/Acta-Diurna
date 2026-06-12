import type { Cookies } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	AUTHOR_COOKIE_NAME,
	READER_COOKIE_NAME,
	deleteAuthorCookie,
	deleteReaderCookie,
	readAuthorCookie,
	readReaderCookie,
	setAuthorCookie,
	setReaderCookie
} from './cookies';

const env = vi.hoisted(() => ({
	SESSION_SECRET: 's'.repeat(32),
	ORIGIN: 'http://localhost:3000'
}));

vi.mock('$lib/server/env', () => ({
	serverEnv: () => env
}));

interface FakeCookies extends Cookies {
	jar: Map<string, string>;
	lastSetOptions: Record<string, unknown> | undefined;
	lastDeleteOptions: Record<string, unknown> | undefined;
}

function fakeCookies(): FakeCookies {
	const jar = new Map<string, string>();
	const cookies: Pick<FakeCookies, 'jar' | 'lastSetOptions' | 'lastDeleteOptions'> & {
		get: (name: string) => string | undefined;
		set: (name: string, value: string, options: Record<string, unknown>) => void;
		delete: (name: string, options: Record<string, unknown>) => void;
	} = {
		jar,
		lastSetOptions: undefined,
		lastDeleteOptions: undefined,
		get: (name) => jar.get(name),
		set(name, value, options) {
			jar.set(name, value);
			this.lastSetOptions = options;
		},
		delete(name, options) {
			jar.delete(name);
			this.lastDeleteOptions = options;
		}
	};
	return cookies as unknown as FakeCookies;
}

const expiresAt = new Date(Date.now() + 60_000);

beforeEach(() => {
	env.ORIGIN = 'http://localhost:3000';
});

describe('author cookie', () => {
	it('roundtrips: set then read returns the raw token', () => {
		const cookies = fakeCookies();
		setAuthorCookie(cookies, 'the-session-token', expiresAt);

		expect(readAuthorCookie(cookies)).toBe('the-session-token');
		expect(cookies.jar.get(AUTHOR_COOKIE_NAME)).not.toBe('the-session-token'); // signed
	});

	it('sets HttpOnly, SameSite=Lax, Path=/ and the session expiry', () => {
		const cookies = fakeCookies();
		setAuthorCookie(cookies, 'token', expiresAt);

		expect(cookies.lastSetOptions).toMatchObject({
			httpOnly: true,
			sameSite: 'lax',
			path: '/',
			secure: false,
			expires: expiresAt
		});
	});

	it('marks the cookie Secure when ORIGIN is https', () => {
		env.ORIGIN = 'https://reports.example.com';
		const cookies = fakeCookies();
		setAuthorCookie(cookies, 'token', expiresAt);

		expect(cookies.lastSetOptions).toMatchObject({ secure: true });
	});

	it('rejects a tampered token (signature mismatch)', () => {
		const cookies = fakeCookies();
		setAuthorCookie(cookies, 'token', expiresAt);
		const signed = cookies.jar.get(AUTHOR_COOKIE_NAME) as string;
		cookies.jar.set(AUTHOR_COOKIE_NAME, `evil${signed.slice(4)}`);

		expect(readAuthorCookie(cookies)).toBeNull();
	});

	it('rejects a forged signature and malformed values', () => {
		const cookies = fakeCookies();
		cookies.jar.set(AUTHOR_COOKIE_NAME, 'token.bm90LXRoZS1zaWduYXR1cmU');
		expect(readAuthorCookie(cookies)).toBeNull();

		cookies.jar.set(AUTHOR_COOKIE_NAME, 'no-separator');
		expect(readAuthorCookie(cookies)).toBeNull();
	});

	it('returns null when the cookie is absent', () => {
		expect(readAuthorCookie(fakeCookies())).toBeNull();
	});

	it('deletes on the same path it was set on', () => {
		const cookies = fakeCookies();
		setAuthorCookie(cookies, 'token', expiresAt);
		deleteAuthorCookie(cookies);

		expect(cookies.jar.has(AUTHOR_COOKIE_NAME)).toBe(false);
		expect(cookies.lastDeleteOptions).toMatchObject({ path: '/' });
	});
});

describe('reader cookie', () => {
	it('roundtrips under the reader cookie name', () => {
		const cookies = fakeCookies();
		setReaderCookie(cookies, 'reader-token', expiresAt);

		expect(readReaderCookie(cookies)).toBe('reader-token');
		expect(cookies.jar.get(READER_COOKIE_NAME)).not.toBe('reader-token'); // signed
	});

	it('sets HttpOnly, SameSite=Lax, Path=/ and the configurable expiry', () => {
		const cookies = fakeCookies();
		const readerExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
		setReaderCookie(cookies, 'token', readerExpiry);

		expect(cookies.lastSetOptions).toMatchObject({
			httpOnly: true,
			sameSite: 'lax',
			path: '/',
			expires: readerExpiry
		});
	});

	it('sets a persistent ~400-day-capped cookie when the session has no expiry (null)', () => {
		const cookies = fakeCookies();
		const before = Date.now();
		setReaderCookie(cookies, 'token', null);
		const after = Date.now();
		const maxDaysMs = 400 * 24 * 60 * 60 * 1000;

		// No DB expiry -> the cookie is still persistent (the session never ends),
		// capped at the browser's ~400-day cookie lifetime maximum.
		const expires = cookies.lastSetOptions?.expires as Date;
		expect(expires).toBeInstanceOf(Date);
		expect(expires.getTime()).toBeGreaterThanOrEqual(before + maxDaysMs);
		expect(expires.getTime()).toBeLessThanOrEqual(after + maxDaysMs);
	});

	it('strict realm separation: a reader cookie is NOT read as an author session', () => {
		// The realms share the signing secret and format but use distinct cookie
		// NAMES, so a valid reader cookie presented to the author reader returns
		// null - the core NFR12 separation property.
		const cookies = fakeCookies();
		setReaderCookie(cookies, 'reader-token', expiresAt);

		expect(readAuthorCookie(cookies)).toBeNull();
		expect(readReaderCookie(cookies)).toBe('reader-token');
	});

	it('strict realm separation: an author cookie is NOT read as a reader session', () => {
		const cookies = fakeCookies();
		setAuthorCookie(cookies, 'author-token', expiresAt);

		expect(readReaderCookie(cookies)).toBeNull();
		expect(readAuthorCookie(cookies)).toBe('author-token');
	});

	it('rejects a tampered reader token (signature mismatch)', () => {
		const cookies = fakeCookies();
		setReaderCookie(cookies, 'token', expiresAt);
		const signed = cookies.jar.get(READER_COOKIE_NAME) as string;
		cookies.jar.set(READER_COOKIE_NAME, `evil${signed.slice(4)}`);

		expect(readReaderCookie(cookies)).toBeNull();
	});

	it('deletes on Path=/', () => {
		const cookies = fakeCookies();
		setReaderCookie(cookies, 'token', expiresAt);
		deleteReaderCookie(cookies);

		expect(cookies.jar.has(READER_COOKIE_NAME)).toBe(false);
		expect(cookies.lastDeleteOptions).toMatchObject({ path: '/' });
	});
});
