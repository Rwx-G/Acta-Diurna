import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Block } from '$lib/schema';
import BlockEditor from './BlockEditor.svelte';

function renderBlock(block: Block, issues: { path: string; message: string; hint?: string }[]) {
	// BlockEditor declares block = $bindable(); a $state source keeps the bind:
	// target reactive (silences binding_property_non_reactive in the test).
	const reactiveBlock = $state(block);
	return render(BlockEditor, {
		block: reactiveBlock,
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
		// The raw indexed path is humanised to a readable field label (no brackets,
		// no indices) so the author sees `alt`, not `sections[0].blocks[0].alt`.
		await expect.element(getByText('alt', { exact: true })).toBeVisible();
	});

	it('renders no alert when the block has no issues', async () => {
		const { getByRole, getByLabelText } = renderBlock(
			{ type: 'text', id: 'intro', paragraphs: [[{ text: 'Fine.' }]] },
			[]
		);

		await expect.element(getByLabelText('Paragraph 1, run 1 text', { exact: true })).toBeVisible();
		expect(getByRole('alert').query()).toBeNull();
	});
});
