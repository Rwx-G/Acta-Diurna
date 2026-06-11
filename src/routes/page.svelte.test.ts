import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

describe('landing page', () => {
	it('renders the product heading', async () => {
		const { getByRole } = render(Page);

		await expect.element(getByRole('heading', { level: 1 })).toHaveTextContent('Acta Diurna');
	});
});
