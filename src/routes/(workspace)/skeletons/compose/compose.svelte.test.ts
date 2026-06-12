import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ComposeHarness from './ComposeHarness.svelte';

describe('composer brick-to-structure flow', () => {
	it('opens with the starter Cover section', async () => {
		const { getByLabelText } = render(ComposeHarness);
		await expect.element(getByLabelText('Section: Cover')).toBeInTheDocument();
	});

	it('clicking a BrickCard appends its section to the StructureTree', async () => {
		const { getByRole, getByLabelText } = render(ComposeHarness);
		expect(getByLabelText('Section: Data table').query()).toBeNull();

		await getByRole('button', { name: 'Add Data table' }).click();

		await expect.element(getByLabelText('Section: Data table')).toBeInTheDocument();
	});

	it('removing a section drops it from the tree', async () => {
		const { getByRole, getByLabelText } = render(ComposeHarness);
		await getByRole('button', { name: 'Add Data table' }).click();
		await expect.element(getByLabelText('Section: Data table')).toBeInTheDocument();

		// Two sections now (Cover, Data table); remove the second.
		const removeButtons = getByRole('button', { name: 'Remove section' });
		await removeButtons.nth(1).click();

		expect(getByLabelText('Section: Data table').query()).toBeNull();
	});
});
