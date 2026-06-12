import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { CodeBlock as CodeBlockType } from '$lib/schema';
import CodeBlock from './CodeBlock.svelte';

function block(overrides: Partial<CodeBlockType> = {}): CodeBlockType {
	return {
		type: 'code',
		id: 'snippet',
		code: 'pnpm install\npnpm build',
		language: 'bash',
		...overrides
	};
}

describe('CodeBlock render', () => {
	it('renders the source inside a <pre><code> monospace block', () => {
		const { container } = render(CodeBlock, { block: block() });
		const pre = container.querySelector('pre.code-pre code');
		expect(pre).not.toBeNull();
		expect(pre?.textContent).toBe('pnpm install\npnpm build');
	});

	it('preserves whitespace and newlines verbatim (white-space: pre)', () => {
		const code = '  indented line\n\ttab line\n\nblank line above';
		const { container } = render(CodeBlock, { block: block({ code }) });
		// The exact characters survive: leading spaces, a tab, a blank line.
		expect(container.querySelector('pre.code-pre code')?.textContent).toBe(code);
	});

	it('shows the optional language as a caption, omitted when absent', () => {
		const withLang = render(CodeBlock, { block: block({ language: 'sql' }) });
		expect(withLang.container.querySelector('.code-language')?.textContent?.trim()).toBe('sql');

		const noLang = render(CodeBlock, { block: block({ language: undefined }) });
		expect(noLang.container.querySelector('.code-language')).toBeNull();
	});

	it('renders annotations as adjacent escaped text, with the optional line label', () => {
		const { container } = render(CodeBlock, {
			block: block({
				annotations: [{ line: 2, text: 'Build step.' }, { text: 'A general note.' }]
			})
		});
		const items = container.querySelectorAll('.code-annotations li');
		expect(items.length).toBe(2);
		expect(items[0].querySelector('.annotation-line')?.textContent?.trim()).toBe('Line 2');
		expect(items[0].textContent).toContain('Build step.');
		// The second annotation has no line, so no line label.
		expect(items[1].querySelector('.annotation-line')).toBeNull();
		expect(items[1].textContent).toContain('A general note.');
	});

	it('omits the annotation list entirely when there are none', () => {
		const { container } = render(CodeBlock, { block: block({ annotations: undefined }) });
		expect(container.querySelector('.code-annotations')).toBeNull();
	});

	it('escapes script-like source instead of executing it (renderer-purity)', () => {
		const { container } = render(CodeBlock, {
			block: block({ code: '<script>alert(1)</script>\n<img src=x onerror=alert(2)>' })
		});
		// No injected element exists: the source is inert visible text only.
		expect(container.querySelector('pre script')).toBeNull();
		expect(container.querySelector('pre img')).toBeNull();
		expect(container.querySelector('pre.code-pre code')?.textContent).toBe(
			'<script>alert(1)</script>\n<img src=x onerror=alert(2)>'
		);
	});

	it('escapes script-like annotation text (renderer-purity)', () => {
		const { container } = render(CodeBlock, {
			block: block({ annotations: [{ text: '<script>alert(1)</script>' }] })
		});
		expect(container.querySelector('.code-annotations script')).toBeNull();
		expect(container.querySelector('.code-annotations')?.textContent).toContain(
			'<script>alert(1)</script>'
		);
	});

	it('ships no copy-to-clipboard button or any button (zero hydration)', () => {
		const { container } = render(CodeBlock, { block: block() });
		expect(container.querySelector('button')).toBeNull();
	});
});
