import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { serverEnv } from '../env';

// Realm separation (NFR12/AR6): each realm gets its OWN cookie name, so an
// author cookie can never be presented as a reader credential or vice versa.
// Both are HMAC-signed with the same SESSION_SECRET and read the same way; only
// the name and which validator consumes the token differ.
export const AUTHOR_COOKIE_NAME = 'acta_author';
export const READER_COOKIE_NAME = 'acta_reader';

function sign(token: string): string {
	return createHmac('sha256', serverEnv().SESSION_SECRET).update(token).digest('base64url');
}

function isSecureOrigin(): boolean {
	return serverEnv().ORIGIN.startsWith('https://');
}

/**
 * Sets a realm session cookie. The value is `<token>.<hmac>`: the HMAC (keyed by
 * SESSION_SECRET) rejects forged or corrupted cookies before any database
 * lookup. HttpOnly + SameSite=Lax always; Secure when the instance is served
 * over https (ORIGIN).
 */
function setSessionCookie(cookies: Cookies, name: string, token: string, expiresAt: Date): void {
	cookies.set(name, `${token}.${sign(token)}`, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: isSecureOrigin(),
		expires: expiresAt
	});
}

/**
 * Reads and authenticates a realm cookie, returning the raw session token or
 * null when the cookie is absent, malformed, or fails the signature check.
 */
function readSessionCookie(cookies: Cookies, name: string): string | null {
	const value = cookies.get(name);
	if (!value) return null;

	const separator = value.lastIndexOf('.');
	if (separator <= 0) return null;

	const token = value.slice(0, separator);
	const given = Buffer.from(value.slice(separator + 1));
	const expected = Buffer.from(sign(token));
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

	return token;
}

export function setAuthorCookie(cookies: Cookies, token: string, expiresAt: Date): void {
	setSessionCookie(cookies, AUTHOR_COOKIE_NAME, token, expiresAt);
}

export function readAuthorCookie(cookies: Cookies): string | null {
	return readSessionCookie(cookies, AUTHOR_COOKIE_NAME);
}

export function deleteAuthorCookie(cookies: Cookies): void {
	cookies.delete(AUTHOR_COOKIE_NAME, { path: '/' });
}

export function setReaderCookie(cookies: Cookies, token: string, expiresAt: Date): void {
	setSessionCookie(cookies, READER_COOKIE_NAME, token, expiresAt);
}

export function readReaderCookie(cookies: Cookies): string | null {
	return readSessionCookie(cookies, READER_COOKIE_NAME);
}

export function deleteReaderCookie(cookies: Cookies): void {
	cookies.delete(READER_COOKIE_NAME, { path: '/' });
}
