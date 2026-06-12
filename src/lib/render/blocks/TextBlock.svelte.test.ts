import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TextBlock as TextBlockType } from '$lib/schema';
import TextBlock from './TextBlock.svelte';

describe('TextBlock', () => {
	it('escapes HTML-looking run text instead of rendering it (XSS rule)', async () => {
		const block: TextBlockType = {
			type: 'text',
			id: 't1',
			paragraphs: [[{ text: '<script>alert(1)</script> & <b>bold</b>' }]]
		};
		const { container } = render(TextBlock, { block });
		// The literal characters must appear as text; no injected element exists.
		expect(container.querySelector('script')).toBeNull();
		const paragraph = container.querySelector('p');
		expect(paragraph?.textContent).toContain('<script>alert(1)</script>');
		// The only <b> in the markup would be from our own formatting, not the run.
		expect(container.querySelector('p b')).toBeNull();
	});

	it('renders bold and italic runs with semantic elements', async () => {
		const block: TextBlockType = {
			type: 'text',
			id: 't2',
			paragraphs: [
				[{ text: 'strong', bold: true }, { text: ' and ' }, { text: 'em', italic: true }]
			]
		};
		const { container } = render(TextBlock, { block });
		expect(container.querySelector('strong')?.textContent).toBe('strong');
		expect(container.querySelector('em')?.textContent).toBe('em');
	});

	it('renders links with rel=noopener noreferrer and target=_blank', async () => {
		const block: TextBlockType = {
			type: 'text',
			id: 't3',
			paragraphs: [[{ text: 'docs', link: { href: 'https://example.com/x' } }]]
		};
		const { container } = render(TextBlock, { block });
		const link = container.querySelector('a');
		expect(link?.getAttribute('href')).toBe('https://example.com/x');
		expect(link?.getAttribute('rel')).toBe('external noopener noreferrer');
		expect(link?.getAttribute('target')).toBe('_blank');
	});
});
