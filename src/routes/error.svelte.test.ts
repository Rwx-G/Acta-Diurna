import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ErrorPage from './+error.svelte';

// The themed neutral page (FR20/NFR9, story 3.5). It is the body of the leak-free
// closed-share response: revoked, expired, and unknown tokens all render this. It
// must leak NOTHING - not a report title, not the reason a link is closed, not a
// status code, not the word "revoked"/"expired" - and it must not interpolate any
// per-error detail (which would make the three closed states distinguishable).

describe('neutral error page', () => {
	it('renders the generic "not available" copy with the wordmark', async () => {
		const { getByRole, getByText } = render(ErrorPage);

		await expect.element(getByText('ACTA DIURNA')).toBeVisible();
		await expect
			.element(getByRole('heading', { level: 1 }))
			.toHaveTextContent('This link is not available');
	});

	it('leaks no reason, title, or status (byte-static body)', async () => {
		const { container } = render(ErrorPage);
		const html = container.innerHTML;

		// None of the leaking signals appear: no "revoked"/"expired" reason that
		// would distinguish the closed states, no report title, no numeric status.
		// (Generic English like "shared" in the help copy is not a leak.)
		expect(html).not.toMatch(/revoked|expired|not available.*because|404|410/i);
		expect(html).not.toMatch(/\bdraft\b|reportid|token_hash/i);
	});
});
