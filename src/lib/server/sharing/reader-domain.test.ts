import { beforeEach, describe, expect, it, vi } from 'vitest';

const { serverEnv } = vi.hoisted(() => ({ serverEnv: vi.fn() }));
vi.mock('$lib/server/env', () => ({ serverEnv }));

import { isReaderEmailDomainAllowed } from './reader-domain';

beforeEach(() => {
	serverEnv.mockReset();
});

describe('isReaderEmailDomainAllowed', () => {
	it('allows any email when READER_EMAIL_DOMAINS is unset (pre-8.5 behavior)', () => {
		serverEnv.mockReturnValue({ READER_EMAIL_DOMAINS: undefined });
		expect(isReaderEmailDomainAllowed('anyone@anywhere.example')).toBe(true);
	});

	it('allows an exact-domain match', () => {
		serverEnv.mockReturnValue({ READER_EMAIL_DOMAINS: ['example.org'] });
		expect(isReaderEmailDomainAllowed('reader@example.org')).toBe(true);
	});

	it('refuses an email outside an exact-domain pattern', () => {
		serverEnv.mockReturnValue({ READER_EMAIL_DOMAINS: ['example.org'] });
		expect(isReaderEmailDomainAllowed('reader@other.org')).toBe(false);
	});

	it('refuses a subdomain under an exact-domain pattern (no implicit wildcard)', () => {
		serverEnv.mockReturnValue({ READER_EMAIL_DOMAINS: ['example.org'] });
		expect(isReaderEmailDomainAllowed('reader@sub.example.org')).toBe(false);
	});

	it('wildcard *.example.com matches a subdomain', () => {
		serverEnv.mockReturnValue({ READER_EMAIL_DOMAINS: ['*.example.com'] });
		expect(isReaderEmailDomainAllowed('reader@a.example.com')).toBe(true);
	});

	it('wildcard *.example.com matches a deep subdomain', () => {
		serverEnv.mockReturnValue({ READER_EMAIL_DOMAINS: ['*.example.com'] });
		expect(isReaderEmailDomainAllowed('reader@a.b.example.com')).toBe(true);
	});

	it('wildcard *.example.com also matches the apex example.com', () => {
		serverEnv.mockReturnValue({ READER_EMAIL_DOMAINS: ['*.example.com'] });
		expect(isReaderEmailDomainAllowed('reader@example.com')).toBe(true);
	});

	it('wildcard *.example.com does not match a lookalike suffix', () => {
		serverEnv.mockReturnValue({ READER_EMAIL_DOMAINS: ['*.example.com'] });
		expect(isReaderEmailDomainAllowed('reader@notexample.com')).toBe(false);
	});

	it('passes when any one of several patterns matches', () => {
		serverEnv.mockReturnValue({ READER_EMAIL_DOMAINS: ['*.example.com', 'example.org'] });
		expect(isReaderEmailDomainAllowed('reader@example.org')).toBe(true);
		expect(isReaderEmailDomainAllowed('reader@team.example.com')).toBe(true);
	});

	it('refuses an email matching none of several patterns', () => {
		serverEnv.mockReturnValue({ READER_EMAIL_DOMAINS: ['*.example.com', 'example.org'] });
		expect(isReaderEmailDomainAllowed('reader@elsewhere.net')).toBe(false);
	});

	it('matches case-insensitively on a mixed-case email domain', () => {
		// READER_EMAIL_DOMAINS is lowercased at the env parse; the helper lowercases
		// the email domain too, so a mixed-case request still matches.
		serverEnv.mockReturnValue({ READER_EMAIL_DOMAINS: ['example.org'] });
		expect(isReaderEmailDomainAllowed('Reader@Example.ORG')).toBe(true);
	});
});
