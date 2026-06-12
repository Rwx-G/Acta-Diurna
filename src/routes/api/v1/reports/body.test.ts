import { describe, expect, it } from 'vitest';
import { readJsonObject, readOptionalExpectedUpdatedAt } from './body';

const MAX_JSON_BODY_BYTES = 2_000_000; // MAX_DOCUMENT_BYTES * 2, mirrored from body.ts

function jsonRequest(body: string, headers: Record<string, string> = {}): Request {
	return new Request('http://localhost/api/v1/reports/x', {
		method: 'PATCH',
		headers: { 'content-type': 'application/json', ...headers },
		body
	});
}

/** A streamed body carries no Content-Length, so the post-read length guard is what fires. */
function streamedRequest(body: string): Request {
	const bytes = new TextEncoder().encode(body);
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		}
	});
	return new Request('http://localhost/api/v1/reports/x', {
		method: 'PATCH',
		body: stream,
		duplex: 'half'
	} as RequestInit & { duplex: 'half' });
}

describe('readJsonObject', () => {
	it('parses a JSON object body', async () => {
		await expect(readJsonObject(jsonRequest('{"title":"Hi"}'))).resolves.toEqual({ title: 'Hi' });
	});

	it('rejects an unparseable body with 400', async () => {
		await expect(readJsonObject(jsonRequest('not json'))).rejects.toMatchObject({ status: 400 });
	});

	it('rejects a non-object (array) body with 400', async () => {
		await expect(readJsonObject(jsonRequest('[1,2,3]'))).rejects.toMatchObject({ status: 400 });
	});

	it('rejects an over-cap declared Content-Length with 413 before reading', async () => {
		// Tiny body, lying oversized Content-Length: the fast path rejects without
		// reading or parsing.
		const req = jsonRequest('{}', { 'content-length': String(MAX_JSON_BODY_BYTES + 1) });
		await expect(readJsonObject(req)).rejects.toMatchObject({ status: 413 });
	});

	it('rejects an over-cap streamed body (no Content-Length) with 413 before parse', async () => {
		const huge = 'x'.repeat(MAX_JSON_BODY_BYTES + 1);
		await expect(readJsonObject(streamedRequest(huge))).rejects.toMatchObject({ status: 413 });
	});
});

describe('readOptionalExpectedUpdatedAt', () => {
	it('returns undefined for an empty body', async () => {
		await expect(readOptionalExpectedUpdatedAt(jsonRequest(''))).resolves.toBeUndefined();
	});

	it('reads a valid expectedUpdatedAt timestamp', async () => {
		const iso = '2026-06-12T10:00:00.000Z';
		const result = await readOptionalExpectedUpdatedAt(
			jsonRequest(`{"expectedUpdatedAt":"${iso}"}`)
		);
		expect(result?.toISOString()).toBe(iso);
	});

	it('rejects an over-cap streamed body with 413', async () => {
		const huge = 'x'.repeat(MAX_JSON_BODY_BYTES + 1);
		await expect(readOptionalExpectedUpdatedAt(streamedRequest(huge))).rejects.toMatchObject({
			status: 413
		});
	});
});
