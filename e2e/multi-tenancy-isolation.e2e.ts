import { expect, test } from '@playwright/test';
import { E2E_MULTI_BASE_URL, MULTI_AUTHORS } from './fixtures.ts';
import { actorContext, mintPat } from './multi-auth.ts';

// Multi-mode tenancy isolation (Epic 8, story 8.2), end to end. Two distinct
// magic-link authors (alice, bob) sign in for real, each mints a PAT carrying their
// own ownerId, and each creates a report over the REST API. The assertion: an
// author's report list contains ONLY their own reports, and a direct GET of the
// other author's report id is a 404 (the no-existence-oracle shape - never a 403,
// which would confirm the id exists). Verified in BOTH directions.
//
// The REST API is the deterministic seam: `resolveApiAuthorScope` filters every
// read/write by the PAT's owner, so this exercises the real 8.2 owner predicate,
// not a forced-state stand-in.

const reportsApi = `${E2E_MULTI_BASE_URL}/api/v1/reports`;

// The app boots with ADDRESS_HEADER=x-forwarded-for, so adapter-node requires the
// header on every request. These bare-fetch REST calls (no Playwright context to
// inject it) therefore carry it explicitly; the value is irrelevant to a PAT-authed
// call (a valid bearer never trips the per-IP api-auth FAILURE limiter).
const xff = { 'x-forwarded-for': '192.0.2.50' };

async function createReport(token: string, title: string): Promise<string> {
	const response = await fetch(reportsApi, {
		method: 'POST',
		headers: { ...xff, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
		body: JSON.stringify({ title })
	});
	expect(response.status).toBe(201);
	const body = (await response.json()) as { id: string };
	return body.id;
}

async function listReportIds(token: string): Promise<string[]> {
	const response = await fetch(reportsApi, {
		headers: { ...xff, authorization: `Bearer ${token}` }
	});
	expect(response.status).toBe(200);
	const body = (await response.json()) as { items: Array<{ id: string }> };
	return body.items.map((item) => item.id);
}

async function getReportStatus(token: string, id: string): Promise<number> {
	const response = await fetch(`${reportsApi}/${id}`, {
		headers: { ...xff, authorization: `Bearer ${token}` }
	});
	return response.status;
}

test('two authors cannot see or fetch each other reports', async ({ browser }) => {
	// Two separate browser contexts, each restored from the author's saved session
	// (signed in once in multi-auth.setup.ts) = two independent author identities.
	const aliceContext = await actorContext(browser, { storageState: MULTI_AUTHORS.alice.state });
	const bobContext = await actorContext(browser, { storageState: MULTI_AUTHORS.bob.state });
	const alicePage = await aliceContext.newPage();
	const bobPage = await bobContext.newPage();

	try {
		const aliceToken = await mintPat(alicePage, 'alice tenancy');
		const aliceReportId = await createReport(aliceToken, 'Alice private report');

		const bobToken = await mintPat(bobPage, 'bob tenancy');
		const bobReportId = await createReport(bobToken, 'Bob private report');

		// Each author's list contains their own report and NOT the other's.
		const aliceList = await listReportIds(aliceToken);
		expect(aliceList).toContain(aliceReportId);
		expect(aliceList).not.toContain(bobReportId);

		const bobList = await listReportIds(bobToken);
		expect(bobList).toContain(bobReportId);
		expect(bobList).not.toContain(aliceReportId);

		// A direct cross-author GET is a 404 (no existence oracle), never a 403.
		expect(await getReportStatus(bobToken, aliceReportId)).toBe(404);
		expect(await getReportStatus(aliceToken, bobReportId)).toBe(404);

		// And each author CAN fetch their own report (proving the 404 above is the
		// tenancy filter, not a broken id).
		expect(await getReportStatus(aliceToken, aliceReportId)).toBe(200);
		expect(await getReportStatus(bobToken, bobReportId)).toBe(200);
	} finally {
		await aliceContext.close();
		await bobContext.close();
	}
});
