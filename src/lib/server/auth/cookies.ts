import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { serverEnv } from '../env';

/** Realm separation (AR6): the reader realm gets its own cookie name in Epic 3. */
export const AUTHOR_COOKIE_NAME = 'acta_author';

function sign(token: string): string {
	return createHmac('sha256', serverEnv().SESSION_SECRET).update(token).digest('base64url');
}

function isSecureOrigin(): boolean {
	return serverEnv().ORIGIN.startsWith('https://');
}

/**
 * Sets the author session cookie. The value is `<token>.<hmac>`: the HMAC
 * (keyed by SESSION_SECRET) rejects forged or corrupted cookies before any
 * database lookup. HttpOnly + SameSite=Lax always; Secure when the instance
 * is served over https (ORIGIN).
 */
export function setAuthorCookie(cookies: Cookies, token: string, expiresAt: Date): void {
	cookies.set(AUTHOR_COOKIE_NAME, `${token}.${sign(token)}`, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: isSecureOrigin(),
		expires: expiresAt
	});
}

/**
 * Reads and authenticates the author cookie, returning the raw session token
 * or null when the cookie is absent, malformed, or fails signature check.
 */
export function readAuthorCookie(cookies: Cookies): string | null {
	const value = cookies.get(AUTHOR_COOKIE_NAME);
	if (!value) return null;

	const separator = value.lastIndexOf('.');
	if (separator <= 0) return null;

	const token = value.slice(0, separator);
	const given = Buffer.from(value.slice(separator + 1));
	const expected = Buffer.from(sign(token));
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

	return token;
}

export function deleteAuthorCookie(cookies: Cookies): void {
	cookies.delete(AUTHOR_COOKIE_NAME, { path: '/' });
}
