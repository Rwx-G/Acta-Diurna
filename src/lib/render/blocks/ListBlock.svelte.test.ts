import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ListBlock as ListBlockType } from '$lib/schema';
import ListBlock from './ListBlock.svelte';

function block(overrides: Partial<ListBlockType> = {}): ListBlockType {
	return {
		type: 'list',
		id: 'remediation',
		ordered: true,
		items: [
			{ term: 'Rotate the credential', description: [[{ text: 'Issue a fresh token.' }]] },
			{ term: 'Revoke the old token' },
			{ description: [[{ text: 'Confirm the change in the audit log.' }]] }
		],
		...overrides
	};
}

describe('ListBlock render', () => {
	it('renders an <ol> when ordered, with one <li> per item', () => {
		const { container } = render(ListBlock, { block: block({ ordered: true }) });
		expect(container.querySelector('ol.list')).not.toBeNull();
		expect(container.querySelector('ul.list')).toBeNull();
		expect(container.querySelectorAll('ol.list > li').length).toBe(3);
	});

	it('renders a <ul> when unordered', () => {
		const { container } = render(ListBlock, { block: block({ ordered: false }) });
		expect(container.querySelector('ul.list')).not.toBeNull();
		expect(container.querySelector('ol.list')).toBeNull();
		expect(container.querySelectorAll('ul.list > li').length).toBe(3);
	});

	it('carries no authored number: the schema has no per-item number and the markup ships none', () => {
		const { container } = render(ListBlock, {
			block: block({
				ordered: true,
				items: [{ term: 'First' }, { term: 'Second' }, { term: 'Third' }]
			})
		});
		// The ordinal is the native <ol> position, never authored text: each term is
		// exactly its label with no leading "1." / "2." prefix in the content.
		const terms = Array.from(container.querySelectorAll('.list-term')).map((t) =>
			t.textContent?.trim()
		);
		expect(terms).toEqual(['First', 'Second', 'Third']);
		for (const term of terms) {
			expect(term).not.toMatch(/^\d+[.)]/);
		}
	});

	it('renders the bold lead term', () => {
		const { container } = render(ListBlock, { block: block() });
		const term = container.querySelector('.list-term');
		expect(term?.textContent?.trim()).toBe('Rotate the credential');
		// The term carries the .list-term class whose style is font-weight 600.
		expect(term?.classList.contains('list-term')).toBe(true);
	});

	it('renders an item with a term but no description (no .list-description)', () => {
		const { container } = render(ListBlock, {
			block: block({ items: [{ term: 'Standalone step' }] })
		});
		expect(container.querySelector('.list-term')?.textContent?.trim()).toBe('Standalone step');
		expect(container.querySelector('.list-description')).toBeNull();
	});

	it('renders an item with a description but no term (no .list-term)', () => {
		const { container } = render(ListBlock, {
			block: block({ items: [{ description: [[{ text: 'Lead-free item.' }]] }] })
		});
		expect(container.querySelector('.list-term')).toBeNull();
		expect(container.querySelector('.list-description')?.textContent).toContain('Lead-free item.');
	});

	it('renders the description rich-text with inline formatting and an inline-code chip', () => {
		const { container } = render(ListBlock, {
			block: block({
				items: [
					{
						term: 'Run the check',
						description: [
							[
								{ text: 'Execute ' },
								{ text: 'pnpm audit', code: true },
								{ text: ' ' },
								{ text: 'before release', bold: true }
							]
						]
					}
				]
			})
		});
		expect(container.querySelector('.list-description code.run-code')?.textContent?.trim()).toBe(
			'pnpm audit'
		);
		expect(container.querySelector('.list-description strong')?.textContent?.trim()).toBe(
			'before release'
		);
		expect(container.querySelector('.list-description')?.textContent).toContain(
			'Execute pnpm audit before release'
		);
	});

	it('renders a description link as an external http(s) anchor', () => {
		const { container } = render(ListBlock, {
			block: block({
				items: [
					{
						term: 'See docs',
						description: [[{ text: 'here', link: { href: 'https://example.com' } }]]
					}
				]
			})
		});
		const link = container.querySelector(
			'.list-description a.run-link'
		) as HTMLAnchorElement | null;
		expect(link?.getAttribute('href')).toBe('https://example.com');
		expect(link?.getAttribute('rel')).toBe('external noopener noreferrer');
	});

	it('escapes an HTML-looking term instead of rendering it (XSS rule)', () => {
		const { container } = render(ListBlock, {
			block: block({ items: [{ term: '<script>alert(1)</script>' }] })
		});
		expect(container.querySelector('.list-term script')).toBeNull();
		expect(container.querySelector('.list-term')?.textContent).toContain(
			'<script>alert(1)</script>'
		);
	});

	it('escapes an HTML-looking description run instead of rendering it', () => {
		const { container } = render(ListBlock, {
			block: block({ items: [{ description: [[{ text: '<img src=x onerror=alert(1)>' }]] }] })
		});
		expect(container.querySelector('.list-description img')).toBeNull();
		expect(container.querySelector('.list-description')?.textContent).toContain(
			'<img src=x onerror=alert(1)>'
		);
	});

	it('renders multiple description paragraphs', () => {
		const { container } = render(ListBlock, {
			block: block({
				items: [{ term: 'Step', description: [[{ text: 'First.' }], [{ text: 'Second.' }]] }]
			})
		});
		expect(container.querySelectorAll('.list-description p').length).toBe(2);
	});
});
