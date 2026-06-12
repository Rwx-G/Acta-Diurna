import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Scale } from '$lib/schema';
import Badge from './Badge.svelte';

const scale: Scale = {
	key: 'status',
	label: 'Status',
	kind: 'nominal',
	entries: [
		{ key: 'done', label: 'Done' },
		{ key: 'blocked', label: 'Blocked', color: '#7a2e3a' }
	]
};

describe('Badge render', () => {
	it('renders the entry label so colour is never the sole signal (AAA, NFR14)', () => {
		const { container } = render(Badge, { scale, entryKey: 'done' });
		expect(container.querySelector('.badge')?.textContent?.trim()).toBe('Done');
	});

	it('derives the colour from the scale: a default-palette entry uses the categorical token', () => {
		const { container } = render(Badge, { scale, entryKey: 'done' });
		// done is index 0 with no explicit colour -> --report-chart-1 = #66023c, the
		// SAME colour the legend resolves for that entry (colour-language parity).
		const badge = container.querySelector('.badge') as HTMLElement | null;
		expect(badge?.getAttribute('style')).toContain('--badge-color: #66023c');
	});

	it('derives the colour from the scale: an explicit author hex is used verbatim', () => {
		const { container } = render(Badge, { scale, entryKey: 'blocked' });
		const badge = container.querySelector('.badge') as HTMLElement | null;
		expect(badge?.getAttribute('style')).toContain('--badge-color: #7a2e3a');
	});

	it('escapes an HTML-looking entry label instead of rendering it (XSS rule)', () => {
		const evil: Scale = {
			key: 'status',
			label: 'Status',
			entries: [{ key: 'done', label: '<script>alert(1)</script>' }]
		};
		const { container } = render(Badge, { scale: evil, entryKey: 'done' });
		expect(container.querySelector('script')).toBeNull();
		expect(container.textContent).toContain('<script>alert(1)</script>');
	});

	it('falls back to the raw key as the label when the entry is missing (no blank)', () => {
		const { container } = render(Badge, { scale, entryKey: 'ghost' });
		expect(container.querySelector('.badge')?.textContent?.trim()).toBe('ghost');
	});
});
