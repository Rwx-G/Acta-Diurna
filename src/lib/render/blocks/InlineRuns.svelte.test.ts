import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Paragraph } from '$lib/schema';
import InlineRuns from './InlineRuns.svelte';

describe('InlineRuns', () => {
	it('renders an inline-code run as a monospace <code> chip', async () => {
		const paragraph: Paragraph = [
			{ text: 'Run ' },
			{ text: 'pnpm build', code: true },
			{ text: ' next.' }
		];
		const { container } = render(InlineRuns, { paragraph });
		const chip = container.querySelector('code.run-code');
		expect(chip?.textContent).toBe('pnpm build');
		expect(container.textContent).toContain('Run pnpm build next.');
	});

	it('renders bold and italic runs with semantic elements', async () => {
		const paragraph: Paragraph = [
			{ text: 'strong', bold: true },
			{ text: ' and ' },
			{ text: 'em', italic: true }
		];
		const { container } = render(InlineRuns, { paragraph });
		expect(container.querySelector('strong')?.textContent).toBe('strong');
		expect(container.querySelector('em')?.textContent).toBe('em');
	});

	it('nests bold inside the code chip (a bold inline-code run is <code><strong>)', async () => {
		const paragraph: Paragraph = [{ text: 'config', code: true, bold: true }];
		const { container } = render(InlineRuns, { paragraph });
		const chip = container.querySelector('code.run-code strong');
		expect(chip?.textContent).toBe('config');
	});

	it('renders a link with target=_blank and rel=external noopener noreferrer', async () => {
		const paragraph: Paragraph = [{ text: 'docs', link: { href: 'https://example.com/x' } }];
		const { container } = render(InlineRuns, { paragraph });
		const link = container.querySelector('a.run-link');
		expect(link?.getAttribute('href')).toBe('https://example.com/x');
		expect(link?.getAttribute('rel')).toBe('external noopener noreferrer');
		expect(link?.getAttribute('target')).toBe('_blank');
		expect(link?.textContent).toContain('docs');
	});

	it('escapes HTML-looking run text instead of rendering it (XSS rule)', async () => {
		const paragraph: Paragraph = [{ text: '<script>alert(1)</script> & <b>bold</b>' }];
		const { container } = render(InlineRuns, { paragraph });
		expect(container.querySelector('script')).toBeNull();
		expect(container.querySelector('b')).toBeNull();
		expect(container.textContent).toContain('<script>alert(1)</script> & <b>bold</b>');
	});

	it('escapes script-like inline-code text instead of rendering it (XSS rule)', async () => {
		const paragraph: Paragraph = [{ text: '<script>alert(1)</script>', code: true }];
		const { container } = render(InlineRuns, { paragraph });
		expect(container.querySelector('code.run-code script')).toBeNull();
		expect(container.querySelector('code.run-code')?.textContent).toBe('<script>alert(1)</script>');
	});

	it('leaves a plain run without marks unchanged (no code, no link)', async () => {
		const paragraph: Paragraph = [{ text: 'plain prose' }];
		const { container } = render(InlineRuns, { paragraph });
		expect(container.querySelector('code')).toBeNull();
		expect(container.querySelector('a')).toBeNull();
		expect(container.textContent?.trim()).toBe('plain prose');
	});
});
