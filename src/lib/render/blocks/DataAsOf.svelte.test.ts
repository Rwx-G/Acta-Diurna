import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import DataAsOf, { formatDataAsOf } from './DataAsOf.svelte';

describe('formatDataAsOf', () => {
	it('formats an ISO instant as a readable UTC date (fixed locale, no tz drift)', () => {
		// en-GB + UTC is deterministic: server and any client produce the same
		// string, so SSR never mismatches hydration and the caption never depends on
		// the reader's locale or timezone.
		expect(formatDataAsOf('2026-06-08T09:30:00.000Z')).toBe('8 Jun 2026');
	});

	it('formats a late-UTC instant on its own calendar day (no rollover)', () => {
		expect(formatDataAsOf('2026-12-31T23:59:00.000Z')).toBe('31 Dec 2026');
	});

	it('returns null for an undefined timestamp (the caption is omitted)', () => {
		expect(formatDataAsOf(undefined)).toBeNull();
	});

	it('returns null for an unparseable timestamp rather than a misleading date', () => {
		expect(formatDataAsOf('not-a-date')).toBeNull();
	});
});

describe('DataAsOf render', () => {
	it('renders the "Data as of <date>" caption when a timestamp is present', () => {
		const { container } = render(DataAsOf, { dataAsOf: '2026-06-08T09:30:00.000Z' });
		const caption = container.querySelector('.data-as-of');
		expect(caption?.textContent?.trim()).toBe('Data as of 8 Jun 2026');
	});

	it('renders nothing when no timestamp is supplied (no placeholder, no unknown date)', () => {
		const { container } = render(DataAsOf, { dataAsOf: undefined });
		expect(container.querySelector('.data-as-of')).toBeNull();
		expect(container.textContent?.trim()).toBe('');
	});

	it('renders nothing for an unparseable timestamp', () => {
		const { container } = render(DataAsOf, { dataAsOf: 'garbage' });
		expect(container.querySelector('.data-as-of')).toBeNull();
	});

	it('escapes an HTML-looking timestamp instead of rendering it (XSS rule)', () => {
		// A malformed timestamp never reaches a caption (it formats to null), so a
		// script-like value renders nothing - never as live markup.
		const { container } = render(DataAsOf, { dataAsOf: '<script>alert(1)</script>' });
		expect(container.querySelector('script')).toBeNull();
		expect(container.querySelector('.data-as-of')).toBeNull();
	});
});
