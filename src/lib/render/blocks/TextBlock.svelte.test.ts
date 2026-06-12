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

	it('renders an inline-code run as a monospace <code> chip', async () => {
		const block: TextBlockType = {
			type: 'text',
			id: 't4',
			paragraphs: [[{ text: 'Run ' }, { text: 'pnpm build', code: true }, { text: ' next.' }]]
		};
		const { container } = render(TextBlock, { block });
		const chip = container.querySelector('code.run-code');
		expect(chip?.textContent).toBe('pnpm build');
		// The surrounding prose is untouched.
		expect(container.querySelector('p')?.textContent).toContain('Run pnpm build next.');
	});

	it('escapes script-like inline-code text instead of rendering it (XSS rule)', async () => {
		const block: TextBlockType = {
			type: 'text',
			id: 't5',
			paragraphs: [[{ text: '<script>alert(1)</script>', code: true }]]
		};
		const { container } = render(TextBlock, { block });
		expect(container.querySelector('code.run-code script')).toBeNull();
		expect(container.querySelector('code.run-code')?.textContent).toBe('<script>alert(1)</script>');
	});

	it('leaves a run without the code mark unchanged (additive mark)', async () => {
		const block: TextBlockType = {
			type: 'text',
			id: 't6',
			paragraphs: [[{ text: 'plain prose' }]]
		};
		const { container } = render(TextBlock, { block });
		expect(container.querySelector('code')).toBeNull();
		expect(container.querySelector('p')?.textContent?.trim()).toBe('plain prose');
	});
});
