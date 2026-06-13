import { beforeEach, describe, expect, it, vi } from 'vitest';

const { serverEnv } = vi.hoisted(() => ({ serverEnv: vi.fn() }));
vi.mock('$lib/server/env', () => ({ serverEnv }));

import { isAuthorEmailInDomain } from './author-domain';

beforeEach(() => {
	serverEnv.mockReset();
});

describe('isAuthorEmailInDomain', () => {
	it('is true for an email whose domain matches AUTHOR_EMAIL_DOMAIN', () => {
		serverEnv.mockReturnValue({ AUTHOR_EMAIL_DOMAIN: 'example.com' });
		expect(isAuthorEmailInDomain('author@example.com')).toBe(true);
	});

	it('is false for an email in a different domain', () => {
		serverEnv.mockReturnValue({ AUTHOR_EMAIL_DOMAIN: 'example.com' });
		expect(isAuthorEmailInDomain('author@other.com')).toBe(false);
	});

	it('matches case-insensitively on the domain', () => {
		serverEnv.mockReturnValue({ AUTHOR_EMAIL_DOMAIN: 'Example.COM' });
		expect(isAuthorEmailInDomain('author@example.com')).toBe(true);
	});

	it('is false for a subdomain (exact-domain match, no wildcard)', () => {
		serverEnv.mockReturnValue({ AUTHOR_EMAIL_DOMAIN: 'example.com' });
		expect(isAuthorEmailInDomain('author@sub.example.com')).toBe(false);
	});

	it('is false when AUTHOR_EMAIL_DOMAIN is unset (single mode, defense in depth)', () => {
		serverEnv.mockReturnValue({ AUTHOR_EMAIL_DOMAIN: undefined });
		expect(isAuthorEmailInDomain('author@example.com')).toBe(false);
	});
});
