import { describe, expect, it } from 'vitest';
import { authorMagicLinkEmail } from './author-magic-link';

describe('authorMagicLinkEmail', () => {
	it('carries the sign-in URL in both text and html', () => {
		const url = 'https://reports.example.com/login/verify?t=abc';
		const message = authorMagicLinkEmail('author@example.com', url);

		expect(message.to).toBe('author@example.com');
		expect(message.text).toContain(url);
		expect(message.html).toContain(url);
		expect(message.subject).toMatch(/sign-in link/i);
	});

	it('does not leak authorization status (NFR9)', () => {
		const message = authorMagicLinkEmail('author@example.com', 'https://x/login/verify?t=abc');
		const body = `${message.subject}\n${message.text}\n${message.html ?? ''}`.toLowerCase();

		expect(body).not.toContain('authorized');
		expect(body).not.toContain('allowed domain');
	});

	it('escapes the URL in the html anchor (defense-in-depth)', () => {
		const message = authorMagicLinkEmail('a@example.com', 'https://x/login/verify?t=a&b="c"');

		expect(message.html).toContain('&amp;');
		expect(message.html).toContain('&quot;');
		expect(message.html).not.toContain('t=a&b="c"');
	});
});
