import { describe, expect, it } from 'vitest';
import { AppError } from '$lib/server/problem';
import { formatFromContentType, readBodyBytes, readFilename, readTargetReportId } from './body';

function request(contentType: string, body = 'x', headers: Record<string, string> = {}): Request {
	return new Request('http://localhost/api/v1/data-sets', {
		method: 'POST',
		headers: { 'content-type': contentType, ...headers },
		body
	});
}

describe('formatFromContentType', () => {
	it('maps text/csv and application/json (ignoring charset)', () => {
		expect(formatFromContentType(request('text/csv'))).toBe('csv');
		expect(formatFromContentType(request('application/json; charset=utf-8'))).toBe('json');
	});

	it('throws the honest 415 for an Excel content-type', () => {
		try {
			formatFromContentType(
				request('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
			);
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(AppError);
			expect((error as AppError).status).toBe(415);
			expect((error as AppError).type).toBe('/problems/excel-not-enabled');
		}
	});

	it('throws 415 for an unsupported content-type', () => {
		try {
			formatFromContentType(request('application/xml'));
			expect.unreachable();
		} catch (error) {
			expect((error as AppError).status).toBe(415);
			expect((error as AppError).type).toBe('/problems/unsupported-format');
		}
	});
});

describe('readTargetReportId', () => {
	const valid = '01970000-0000-7000-8000-000000000001';

	it('returns null when absent', () => {
		expect(readTargetReportId(new URL('http://localhost/api/v1/data-sets'))).toBeNull();
	});

	it('returns a valid uuid', () => {
		expect(readTargetReportId(new URL(`http://localhost/api/v1/data-sets?reportId=${valid}`))).toBe(
			valid
		);
	});

	it('throws 400 on a malformed reportId', () => {
		expect(() =>
			readTargetReportId(new URL('http://localhost/api/v1/data-sets?reportId=nope'))
		).toThrow(AppError);
	});
});

describe('readFilename', () => {
	it('uses the X-Filename header when present', () => {
		expect(readFilename(request('text/csv', 'x', { 'x-filename': 'export.csv' }), 'csv')).toBe(
			'export.csv'
		);
	});

	it('falls back to a format default', () => {
		expect(readFilename(request('application/json'), 'json')).toBe('api-push.json');
	});
});

describe('readBodyBytes', () => {
	it('reads the body to bytes', async () => {
		const bytes = await readBodyBytes(request('text/csv', 'a,b\n1,2'));
		expect(new TextDecoder().decode(bytes)).toBe('a,b\n1,2');
	});

	it('rejects an over-cap Content-Length with 413 before reading', async () => {
		const req = request('text/csv', 'small', { 'content-length': String(60_000_000) });
		await expect(readBodyBytes(req)).rejects.toMatchObject({ status: 413 });
	});

	it('aborts the stream with 413 once cumulative bytes exceed the cap, without buffering it all', async () => {
		// A stream that would yield far more than the cap (one 1 MB chunk per pull),
		// and no honest Content-Length. The fast-path pre-check cannot save us here;
		// the streaming abort must stop AT the cap. We assert it (a) throws 413 and
		// (b) cancels the reader before pulling the whole (here, effectively
		// unbounded) body - proved by `cancelled` flipping and the pull count
		// staying near the cap, not running away.
		const chunkSize = 1_000_000;
		const cap = 50_000_000;
		let pulls = 0;
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulls += 1;
				// Yield well past the cap if never cancelled; the abort must cut it off.
				if (pulls > (cap / chunkSize) * 4) {
					controller.close();
					return;
				}
				controller.enqueue(new Uint8Array(chunkSize));
			},
			cancel() {
				cancelled = true;
			}
		});
		const req = new Request('http://localhost/api/v1/data-sets', {
			method: 'POST',
			headers: { 'content-type': 'text/csv' },
			body,
			// Node's fetch Request needs duplex for a stream body.
			duplex: 'half'
		} as RequestInit & { duplex: 'half' });

		await expect(readBodyBytes(req)).rejects.toMatchObject({ status: 413 });
		expect(cancelled).toBe(true);
		// Stopped at the cap: one chunk over (51 pulls), nowhere near the 200-pull runaway.
		expect(pulls).toBeLessThanOrEqual(cap / chunkSize + 2);
	});

	it('rejects an empty body with 400', async () => {
		await expect(readBodyBytes(request('text/csv', ''))).rejects.toMatchObject({ status: 400 });
	});
});
