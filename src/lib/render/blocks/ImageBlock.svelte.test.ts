import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ImageBlock as ImageBlockType } from '$lib/schema';
import ImageBlock from './ImageBlock.svelte';

const ASSET_ID = '11111111-2222-3333-4444-555555555555';

function block(overrides: Partial<ImageBlockType> = {}): ImageBlockType {
	return {
		type: 'image',
		id: 'diagram',
		assetId: ASSET_ID,
		alt: 'Network topology diagram',
		...overrides
	};
}

describe('ImageBlock render', () => {
	// Pixels arrive in Epic 2; the block renders an accessible placeholder frame
	// (role="img") keyed by assetId and carrying the required alt text. The
	// accessibility contract is asserted on that frame.
	it('exposes the alt text as the accessible name of the image frame', () => {
		const { container } = render(ImageBlock, { block: block() });
		const frame = container.querySelector('[role="img"]');
		expect(frame?.getAttribute('aria-label')).toBe('Network topology diagram');
	});

	it('keys the frame by the asset id', () => {
		const { container } = render(ImageBlock, { block: block() });
		const frame = container.querySelector('[role="img"]');
		expect(frame?.getAttribute('data-asset-id')).toBe(ASSET_ID);
	});

	it('renders no caption when none is provided', () => {
		const { container } = render(ImageBlock, { block: block() });
		expect(container.querySelector('figcaption')).toBeNull();
	});

	it('renders the optional caption', () => {
		const { container } = render(ImageBlock, { block: block({ caption: 'Figure 1' }) });
		expect(container.querySelector('figcaption')?.textContent?.trim()).toBe('Figure 1');
	});

	it('escapes HTML-looking alt and caption instead of rendering them (XSS rule)', () => {
		const { container } = render(ImageBlock, {
			block: block({ alt: '<script>alert(1)</script>', caption: '<b>caption</b>' })
		});
		expect(container.querySelector('script')).toBeNull();
		expect(container.querySelector('figcaption b')).toBeNull();
		expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
			'<script>alert(1)</script>'
		);
		expect(container.textContent).toContain('<b>caption</b>');
	});
});
