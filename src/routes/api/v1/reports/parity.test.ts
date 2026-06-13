/**
 * FR2/FR30 validation-parity proof (story 4.2). The `/api/v1/reports` endpoints
 * are thin adapters over the EXACT services the workspace calls, so an invalid
 * document submitted via the API must yield the SAME actionable problem+json
 * (block path/field/hint) the workspace save produces. This test proves it
 * end-to-end WITHOUT mocking the service: the real POST handler calls the real
 * `createReportWithDocument`, whose `validateOrThrow` runs before any DB access,
 * so an invalid document yields the 422 problem+json the `runApi` wrapper formats
 * - and its `errors[]` is byte-identical to what `validateDocument` produces (the
 * one validation contract both surfaces share).
 */
import { describe, expect, it } from 'vitest';
import { validateDocument, toProblemDetails } from '$lib/schema';
import { POST } from './+server';

// A document missing `version` (the version-registry rejects it) and, separately,
// an image block with no `alt` (the accessibility hint path) - two distinct
// failure shapes proving the hint travels intact.
const INVALID_DOCUMENT = {
	version: 1,
	title: 'Bad',
	sections: [
		{
			id: '01970000-0000-7000-8000-0000000000aa',
			title: 'S',
			blocks: [{ type: 'image', id: '01970000-0000-7000-8000-0000000000bb', assetId: 'not-a-uuid' }]
		}
	]
};

function postWith(document: unknown): Parameters<typeof POST>[0] {
	return {
		locals: { apiIdentity: { tokenId: 'tok', ownerId: '01970000-0000-7000-8000-0000000000aa' } },
		request: new Request('http://localhost/api/v1/reports', {
			method: 'POST',
			body: JSON.stringify({ document })
		})
	} as unknown as Parameters<typeof POST>[0];
}

describe('FR2 validation parity (API vs service)', () => {
	it('the API returns the SAME actionable errors[] the schema contract produces', async () => {
		// What the workspace/service sees: the canonical validation result.
		const result = validateDocument(INVALID_DOCUMENT);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		const expected = toProblemDetails(result.errors);

		// What the API surfaces: the real POST handler over the real service yields
		// a 422 problem+json before any DB call.
		const response = await POST(postWith(INVALID_DOCUMENT));

		expect(response.status).toBe(422);
		expect(response.headers.get('content-type')).toBe('application/problem+json');
		const body = (await response.json()) as {
			type: string;
			title: string;
			errors: Array<{ path: string; message: string; hint?: string }>;
		};
		expect(body.type).toBe(expected.type);
		expect(body.title).toBe(expected.title);
		// The load-bearing assertion: byte-identical actionable errors[] with the
		// block path, message, and fix hint (FR2).
		expect(body.errors).toEqual(expected.errors);
		expect(body.errors.some((e) => e.path.includes('alt') && e.hint !== undefined)).toBe(true);
	});
});
