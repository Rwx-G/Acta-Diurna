import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { getBrick } from '$lib/bricks';
import BrickCard from './BrickCard.svelte';

describe('BrickCard', () => {
	it('shows the brick label and description', async () => {
		const brick = getBrick('dataTable')!;
		const { getByText } = render(BrickCard, { brick, onAdd: vi.fn() });
		await expect.element(getByText('Data table')).toBeVisible();
		await expect.element(getByText(brick.description)).toBeVisible();
	});

	it('calls onAdd when clicked', async () => {
		const brick = getBrick('cover')!;
		const onAdd = vi.fn();
		const { getByRole } = render(BrickCard, { brick, onAdd });
		await getByRole('button', { name: 'Add Cover' }).click();
		expect(onAdd).toHaveBeenCalledOnce();
	});
});
