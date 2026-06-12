import { describe, expect, it } from 'vitest';
import { magicLinkEmail } from './magic-link';

describe('magicLinkEmail', () => {
	it('carries the verify URL in both text and html', () => {
		const url = 'https://reports.example.com/r/tok/verify?t=abc';
		const message = magicLinkEmail('reader@example.com', url);

		expect(message.to).toBe('reader@example.com');
		expect(message.text).toContain(url);
		expect(message.html).toContain(url);
		expect(message.subject).toMatch(/access link/i);
	});

	it('does not leak report, share, or authorization status (NFR9)', () => {
		const message = magicLinkEmail('reader@example.com', 'https://x/r/tok/verify?t=abc');
		const body = `${message.subject}\n${message.text}\n${message.html ?? ''}`.toLowerCase();

		// The email is report-agnostic and never states the recipient is "allowed"
		// or on any list.
		expect(body).not.toContain('authorized');
		expect(body).not.toContain('recipient list');
		expect(body).not.toContain('share id');
	});

	it('escapes the URL in the html anchor (defense-in-depth)', () => {
		const message = magicLinkEmail('r@example.com', 'https://x/v?t=a&b="c"');

		expect(message.html).toContain('&amp;');
		expect(message.html).toContain('&quot;');
		expect(message.html).not.toContain('t=a&b="c"');
	});
});
