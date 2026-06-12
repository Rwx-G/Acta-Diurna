import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { serverEnv } from '../env';

// Realm separation (NFR12/AR6): each realm gets its OWN cookie name, so an
// author cookie can never be presented as a reader credential or vice versa.
// Both are HMAC-signed with the same SESSION_SECRET and read the same way; only
// the name and which validator consumes the token differ.
//
// The `__Host-` prefix is a browser-enforced hardening: a cookie so named is
// REJECTED by the browser unless it is Secure, has Path=/, and carries NO Domain
// attribute - which structurally prevents a sibling subdomain (or a response over
// a downgraded channel) from planting a cookie that shadows the session. It works
// on http://localhost (a secure context, so Secure cookies are accepted there)
// and, in production, the env guard forces a https ORIGIN, so the always-Secure
// flag below is never sent over a plaintext non-loopback connection.
export const AUTHOR_COOKIE_NAME = '__Host-acta_author';
export const READER_COOKIE_NAME = '__Host-acta_reader';

// Browser hard cap on cookie lifetime: a Set-Cookie `Expires`/`Max-Age` beyond
// ~400 days is clamped by the browser (Chrome/Firefox), so there is no point
// asking for more. A reader session with no DB expiry is eternal server-side,
// but the cookie carrying it can only persist this long, so a returning reader
// re-verifies at most every ~400 days. That is not an access bound: the share's
// expiry + revocation (re-checked by the gate on every load) governs real
// access. The re-verification is only the cost of the browser dropping the
// cookie, not the session ending.
const READER_COOKIE_MAX_DAYS = 400;

function sign(token: string): string {
	return createHmac('sha256', serverEnv().SESSION_SECRET).update(token).digest('base64url');
}

/**
 * Sets a realm session cookie. The value is `<token>.<hmac>`: the HMAC (keyed by
 * SESSION_SECRET) rejects forged or corrupted cookies before any database
 * lookup. HttpOnly + SameSite=Lax + Path=/ + Secure, always: the `__Host-` cookie
 * name prefix REQUIRES Secure and Path=/, and the production env guard forces a
 * https ORIGIN so Secure is never sent over a plaintext non-loopback channel.
 */
function setSessionCookie(cookies: Cookies, name: string, token: string, expiresAt: Date): void {
	cookies.set(name, `${token}.${sign(token)}`, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: true,
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
	cookies.delete(AUTHOR_COOKIE_NAME, { path: '/', secure: true });
}

/**
 * Sets the reader cookie. `expiresAt` mirrors the DB session expiry: a Date when
 * the operator set READER_SESSION_TTL, or null (the default) when the session
 * has no time bound. A null expiry still gets a PERSISTENT cookie - the session
 * never ends - capped at the browser's ~400-day cookie lifetime maximum, after
 * which the reader re-verifies. The share governs real access, not the cookie.
 */
export function setReaderCookie(cookies: Cookies, token: string, expiresAt: Date | null): void {
	const cookieExpiry =
		expiresAt ?? new Date(Date.now() + READER_COOKIE_MAX_DAYS * 24 * 60 * 60 * 1000);
	setSessionCookie(cookies, READER_COOKIE_NAME, token, cookieExpiry);
}

export function readReaderCookie(cookies: Cookies): string | null {
	return readSessionCookie(cookies, READER_COOKIE_NAME);
}

export function deleteReaderCookie(cookies: Cookies): void {
	cookies.delete(READER_COOKIE_NAME, { path: '/', secure: true });
}
