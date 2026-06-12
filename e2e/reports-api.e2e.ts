import { expect, test } from '@playwright/test';
import { E2E_BASE_URL } from './fixtures.ts';

// Story 4.2: the full programmatic report lifecycle over /api/v1 with a real PAT,
// proving workspace parity end-to-end (FR30). Mint a token in settings (shown
// once), then drive create -> get -> patch title -> publish -> get-reflects-
// published -> delete-published-409, and fetch the public OpenAPI spec.
//
// Authenticated via the `setup` project's storage state for the settings UI step
// only; every /api/v1 call uses the Bearer token, never the cookie (strict realm
// separation, 4.1). The settings POST carries an explicit Origin (the HTTP-only
// CSRF concession the other workspace specs use; production is HTTPS).
test('full report lifecycle over /api/v1 with a PAT, plus the OpenAPI spec', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	// The OpenAPI spec is PUBLIC (no bearer) and a valid 3.1 document.
	const spec = await page.request.get(`${E2E_BASE_URL}/api/v1/openapi.json`, {
		failOnStatusCode: false
	});
	expect(spec.status()).toBe(200);
	const specBody = (await spec.json()) as {
		openapi: string;
		paths: Record<string, unknown>;
		components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
	};
	expect(specBody.openapi).toBe('3.1.0');
	expect(specBody.paths['/reports']).toBeDefined();
	expect(specBody.components.schemas.Document).toBeDefined();
	expect(specBody.components.securitySchemes.patBearer).toBeDefined();

	// Mint a PAT via settings (shown once).
	await page.goto('/settings');
	await page.getByLabel('Token name').fill('e2e reports api');
	await page.getByRole('button', { name: 'Create token' }).click();
	const rawToken = (await page.locator('.created-url').textContent())!.trim();
	expect(rawToken).toMatch(/^acta_pat_[A-Za-z0-9_-]{43}$/);
	const auth = { authorization: `Bearer ${rawToken}` };
	const base = `${E2E_BASE_URL}/api/v1/reports`;

	// CREATE -> 201.
	const created = await page.request.post(base, {
		headers: { ...auth, 'content-type': 'application/json' },
		data: { title: 'Lifecycle report' },
		failOnStatusCode: false
	});
	expect(created.status()).toBe(201);
	const report = (await created.json()) as { id: string; title: string; status: string };
	expect(report.status).toBe('draft');
	const url = `${base}/${report.id}`;

	// GET -> 200.
	const fetched = await page.request.get(url, { headers: auth, failOnStatusCode: false });
	expect(fetched.status()).toBe(200);
	expect(((await fetched.json()) as { id: string }).id).toBe(report.id);

	// PATCH title -> 200, title reflected.
	const patched = await page.request.patch(url, {
		headers: { ...auth, 'content-type': 'application/json' },
		data: { title: 'Renamed via API' },
		failOnStatusCode: false
	});
	expect(patched.status()).toBe(200);
	expect(((await patched.json()) as { title: string }).title).toBe('Renamed via API');

	// PUBLISH -> 200, status published.
	const published = await page.request.post(`${url}/publish`, {
		headers: auth,
		failOnStatusCode: false
	});
	expect(published.status()).toBe(200);
	expect(((await published.json()) as { status: string }).status).toBe('published');

	// GET reflects published.
	const afterPublish = await page.request.get(url, { headers: auth, failOnStatusCode: false });
	expect(((await afterPublish.json()) as { status: string }).status).toBe('published');

	// DUPLICATE the published report -> 201, a fresh editable draft (FR10 parity).
	const duplicated = await page.request.post(`${url}/duplicate`, {
		headers: auth,
		failOnStatusCode: false
	});
	expect(duplicated.status()).toBe(201);
	const duplicate = (await duplicated.json()) as { id: string; status: string };
	expect(duplicate.status).toBe('draft');
	expect(duplicate.id).not.toBe(report.id);
	// Clean up the duplicate draft.
	const deletedDuplicate = await page.request.delete(`${base}/${duplicate.id}`, {
		headers: auth,
		failOnStatusCode: false
	});
	expect(deletedDuplicate.status()).toBe(204);

	// Duplicating an unknown id -> 404 problem+json.
	const duplicateUnknown = await page.request.post(
		`${base}/01970000-0000-7000-8000-0000000000ff/duplicate`,
		{ headers: auth, failOnStatusCode: false }
	);
	expect(duplicateUnknown.status()).toBe(404);
	expect(duplicateUnknown.headers()['content-type']).toContain('application/problem+json');

	// DELETE a published report -> 409 problem+json (the draft-only rule).
	const deletePublished = await page.request.delete(url, {
		headers: auth,
		failOnStatusCode: false
	});
	expect(deletePublished.status()).toBe(409);
	expect(deletePublished.headers()['content-type']).toContain('application/problem+json');

	// Unpublish then delete the draft -> 204.
	const unpublished = await page.request.post(`${url}/unpublish`, {
		headers: auth,
		failOnStatusCode: false
	});
	expect(unpublished.status()).toBe(200);
	const deleted = await page.request.delete(url, { headers: auth, failOnStatusCode: false });
	expect(deleted.status()).toBe(204);

	// An invalid document yields a 422 problem+json carrying actionable errors[].
	const invalid = await page.request.post(base, {
		headers: { ...auth, 'content-type': 'application/json' },
		data: { document: { version: 1, title: 'x', sections: [] } },
		failOnStatusCode: false
	});
	expect(invalid.status()).toBe(422);
	expect(invalid.headers()['content-type']).toContain('application/problem+json');
	const problem = (await invalid.json()) as { errors: Array<{ path: string; message: string }> };
	expect(problem.errors.length).toBeGreaterThan(0);
	expect(problem.errors[0]).toHaveProperty('path');

	// A request with no bearer is a 401, never a redirect.
	const noBearer = await page.request.get(base, { maxRedirects: 0, failOnStatusCode: false });
	expect(noBearer.status()).toBe(401);
});
