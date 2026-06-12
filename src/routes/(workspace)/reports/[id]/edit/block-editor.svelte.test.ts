import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Block } from '$lib/schema';
import BlockEditor from './BlockEditor.svelte';

function renderBlock(block: Block, issues: { path: string; message: string; hint?: string }[]) {
	return render(BlockEditor, {
		block,
		sectionIndex: 0,
		blockIndex: 0,
		count: 1,
		issues,
		onEdit: vi.fn(),
		onRemove: vi.fn(),
		onMove: vi.fn()
	});
}

describe('BlockEditor inline validation', () => {
	it('renders each issue at the block with message, hint and field path', async () => {
		const { getByRole, getByText } = renderBlock(
			{ type: 'image', id: 'figure', assetId: '', alt: '' },
			[
				{
					path: 'sections[0].blocks[0].alt',
					message: 'Alt text must not be empty.',
					hint: 'Describe the image for screen readers; alt text is required on every image block.'
				}
			]
		);

		await expect.element(getByRole('alert')).toBeVisible();
		await expect.element(getByText('Alt text must not be empty.')).toBeVisible();
		await expect
			.element(getByText('Describe the image for screen readers', { exact: false }))
			.toBeVisible();
		// Regex form: brackets in a string locator are parsed as selector syntax.
		await expect.element(getByText(/sections\[0\]\.blocks\[0\]\.alt/)).toBeVisible();
	});

	it('renders no alert when the block has no issues', async () => {
		const { getByRole, getByLabelText } = renderBlock(
			{ type: 'text', id: 'intro', paragraphs: [[{ text: 'Fine.' }]] },
			[]
		);

		await expect.element(getByLabelText('Paragraph 1', { exact: true })).toBeVisible();
		expect(getByRole('alert').query()).toBeNull();
	});
});
