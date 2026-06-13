import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

describe('login page', () => {
	it('renders the wordmark and the password form in single mode', async () => {
		const { getByRole, getByLabelText, getByText } = render(Page, {
			data: { multi: false },
			form: null
		});

		await expect.element(getByText('Acta Diurna')).toBeVisible();
		await expect
			.element(getByRole('heading', { level: 1 }))
			.toHaveTextContent('Sign in to your workspace');
		await expect.element(getByLabelText('Password')).toBeVisible();
		await expect.element(getByRole('button', { name: 'Sign in' })).toBeVisible();
	});

	it('shows the uniform error message after a failed attempt (single mode)', async () => {
		const { getByRole } = render(Page, {
			data: { multi: false },
			form: { message: 'Invalid credentials' }
		});

		await expect.element(getByRole('alert')).toHaveTextContent('Invalid credentials');
	});

	it('renders the email field and no password field in multi mode', async () => {
		const { getByLabelText, getByRole, container } = render(Page, {
			data: { multi: true },
			form: null
		});

		await expect.element(getByLabelText('Email')).toBeVisible();
		// Password login is disabled in multi mode (story 8.3): the field is absent.
		expect(container.querySelector('input[type="password"]')).toBeNull();
		await expect.element(getByRole('button', { name: 'Send sign-in link' })).toBeVisible();
	});

	it('shows the neutral confirmation after a sign-in request (multi mode)', async () => {
		const { getByRole } = render(Page, {
			data: { multi: true },
			form: { state: 'sent' }
		});

		await expect.element(getByRole('status')).toHaveTextContent('Check your email');
	});
});
