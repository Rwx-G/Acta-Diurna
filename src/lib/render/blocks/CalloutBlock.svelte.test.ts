import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { CalloutBlock as CalloutBlockType } from '$lib/schema';
import { CALLOUT_TONES } from '$lib/schema';
import CalloutBlock from './CalloutBlock.svelte';

function block(overrides: Partial<CalloutBlockType> = {}): CalloutBlockType {
	return {
		type: 'callout',
		id: 'verdict',
		tone: 'warning',
		icon: 'alert',
		kicker: 'Heads up',
		body: [[{ text: 'Rotate the exposed credentials before release.' }]],
		...overrides
	};
}

describe('CalloutBlock render', () => {
	it('renders a tone class per tone, the seam to the theme token (colour, not hex)', () => {
		for (const tone of CALLOUT_TONES) {
			const { container } = render(CalloutBlock, { block: block({ tone }) });
			expect(container.querySelector(`.callout.tone-${tone}`)).not.toBeNull();
		}
	});

	it('renders the optional icon and kicker when set', () => {
		const { container } = render(CalloutBlock, { block: block() });
		expect(container.querySelector('.callout-icon svg')).not.toBeNull();
		expect(container.querySelector('.callout-kicker')?.textContent?.trim()).toBe('Heads up');
	});

	it('omits the header entirely when neither icon nor kicker is set', () => {
		const { container } = render(CalloutBlock, {
			block: block({ icon: undefined, kicker: undefined })
		});
		expect(container.querySelector('.callout-header')).toBeNull();
		expect(container.querySelector('.callout-icon')).toBeNull();
		expect(container.querySelector('.callout-kicker')).toBeNull();
	});

	it('renders the icon without a kicker, and a kicker without an icon', () => {
		const iconOnly = render(CalloutBlock, { block: block({ kicker: undefined }) });
		expect(iconOnly.container.querySelector('.callout-icon')).not.toBeNull();
		expect(iconOnly.container.querySelector('.callout-kicker')).toBeNull();

		const kickerOnly = render(CalloutBlock, { block: block({ icon: undefined }) });
		expect(kickerOnly.container.querySelector('.callout-icon')).toBeNull();
		expect(kickerOnly.container.querySelector('.callout-kicker')).not.toBeNull();
	});

	it('signals tone beyond colour: the kicker label carries the meaning in words (NFR14)', () => {
		const { container } = render(CalloutBlock, {
			block: block({ tone: 'danger', kicker: 'Critical' })
		});
		// The tone class drives the colour, but the meaning also lives in the visible
		// kicker text, so the callout survives without colour.
		expect(container.querySelector('.callout.tone-danger')).not.toBeNull();
		expect(container.querySelector('.callout-kicker')?.textContent?.trim()).toBe('Critical');
	});

	it('marks the icon decorative (aria-hidden) so it is never the sole signal', () => {
		const { container } = render(CalloutBlock, { block: block() });
		expect(container.querySelector('.callout-icon svg')?.getAttribute('aria-hidden')).toBe('true');
	});

	it('renders the rich-text body with inline-run formatting', () => {
		const { container } = render(CalloutBlock, {
			block: block({
				body: [[{ text: 'See ' }, { text: 'the runbook', bold: true }, { text: ' first.' }]]
			})
		});
		expect(container.querySelector('.callout-body strong')?.textContent?.trim()).toBe(
			'the runbook'
		);
		expect(container.querySelector('.callout-body')?.textContent).toContain(
			'See the runbook first.'
		);
	});

	it('renders a body link as an external http(s) anchor', () => {
		const { container } = render(CalloutBlock, {
			block: block({ body: [[{ text: 'docs', link: { href: 'https://example.com' } }]] })
		});
		const link = container.querySelector('.callout-body a.run-link') as HTMLAnchorElement | null;
		expect(link?.getAttribute('href')).toBe('https://example.com');
		expect(link?.getAttribute('rel')).toBe('external noopener noreferrer');
	});

	it('escapes an HTML-looking body run instead of rendering it (XSS rule)', () => {
		const { container } = render(CalloutBlock, {
			block: block({ body: [[{ text: '<script>alert(1)</script>' }]] })
		});
		expect(container.querySelector('.callout-body script')).toBeNull();
		expect(container.querySelector('.callout-body')?.textContent).toContain(
			'<script>alert(1)</script>'
		);
	});

	it('renders multiple body paragraphs', () => {
		const { container } = render(CalloutBlock, {
			block: block({ body: [[{ text: 'First.' }], [{ text: 'Second.' }]] })
		});
		expect(container.querySelectorAll('.callout-body p').length).toBe(2);
	});
});
