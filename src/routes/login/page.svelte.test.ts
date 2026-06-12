import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

describe('login page', () => {
	it('renders the wordmark and the password form', async () => {
		const { getByRole, getByLabelText, getByText } = render(Page, { form: null });

		await expect.element(getByText('Acta Diurna')).toBeVisible();
		await expect.element(getByRole('heading', { level: 1 })).toHaveTextContent('Author sign-in');
		await expect.element(getByLabelText('Password')).toBeVisible();
		await expect.element(getByRole('button', { name: 'Sign in' })).toBeVisible();
	});

	it('shows the uniform error message after a failed attempt', async () => {
		const { getByRole } = render(Page, { form: { message: 'Invalid credentials' } });

		await expect.element(getByRole('alert')).toHaveTextContent('Invalid credentials');
	});
});
