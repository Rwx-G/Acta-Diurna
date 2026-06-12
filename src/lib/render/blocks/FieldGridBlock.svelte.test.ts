import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { FieldGridBlock as FieldGridBlockType } from '$lib/schema';
import FieldGridBlock from './FieldGridBlock.svelte';

function block(overrides: Partial<FieldGridBlockType> = {}): FieldGridBlockType {
	return {
		type: 'field-grid',
		id: 'metadata',
		items: [
			{ label: 'Author', value: 'Security team' },
			{ label: 'Date', value: 'Q2 2026' }
		],
		...overrides
	};
}

describe('FieldGridBlock render', () => {
	it('renders each item as a dt/dd pair in a description list', () => {
		const { container } = render(FieldGridBlock, { block: block() });
		expect(container.querySelector('dl.field-grid')).not.toBeNull();
		const terms = Array.from(container.querySelectorAll('dt')).map((t) => t.textContent?.trim());
		const defs = Array.from(container.querySelectorAll('dd')).map((d) => d.textContent?.trim());
		expect(terms).toEqual(['Author', 'Date']);
		expect(defs).toEqual(['Security team', 'Q2 2026']);
	});

	it('renders one .field cell per item (the responsive grid unit)', () => {
		const { container } = render(FieldGridBlock, {
			block: block({
				items: [
					{ label: 'A', value: '1' },
					{ label: 'B', value: '2' },
					{ label: 'C', value: '3' }
				]
			})
		});
		expect(container.querySelectorAll('.field-grid .field').length).toBe(3);
	});

	it('escapes an HTML-looking value instead of rendering it (XSS rule)', () => {
		const { container } = render(FieldGridBlock, {
			block: block({ items: [{ label: 'Scope', value: '<script>alert(1)</script>' }] })
		});
		expect(container.querySelector('script')).toBeNull();
		expect(container.textContent).toContain('<script>alert(1)</script>');
	});

	it('escapes an HTML-looking label instead of rendering it', () => {
		const { container } = render(FieldGridBlock, {
			block: block({ items: [{ label: '<b>Status</b>', value: 'Final' }] })
		});
		expect(container.querySelector('dt b')).toBeNull();
		expect(container.textContent).toContain('<b>Status</b>');
	});
});
