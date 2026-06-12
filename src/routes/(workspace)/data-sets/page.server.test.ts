import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/ingestion', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/ingestion')>();
	return {
		...actual,
		ingestFile: vi.fn(),
		listDataSets: vi.fn()
	};
});

import { ingestFile, MAX_UPLOAD_BYTES, type DataSet } from '$lib/server/ingestion';
import { actions } from './+page.server';

const ingestFileMock = vi.mocked(ingestFile);

type UploadAction = (typeof actions)['upload'];

function event(request: Request): Parameters<UploadAction>[0] {
	return { request } as unknown as Parameters<UploadAction>[0];
}

/** A real multipart request the action's `.formData()` re-parse can read. */
function multipartRequest(file: File): Request {
	const form = new FormData();
	form.set('file', file);
	return new Request('http://localhost/data-sets?/upload', { method: 'POST', body: form });
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('upload action - streaming cap parity (2.4 follow-up)', () => {
	it('ingests a within-cap upload end to end', async () => {
		ingestFileMock.mockResolvedValue({ id: 'ds-1', filename: 'weekly.csv' } as DataSet);

		const file = new File(['week,count\n2026-06-01,3'], 'weekly.csv', { type: 'text/csv' });
		const result = await actions.upload(event(multipartRequest(file)));

		expect(result).toEqual({ uploaded: { id: 'ds-1', filename: 'weekly.csv' } });
		expect(ingestFileMock).toHaveBeenCalledOnce();
		const passed = ingestFileMock.mock.calls[0][0].file;
		expect(passed.name).toBe('weekly.csv');
	});

	it('rejects an oversized multipart body at the cap WITHOUT fully buffering it', async () => {
		// A streamed body that would yield far more than the cap (1 MB per pull) and
		// declares no honest Content-Length, so only the streaming abort can stop it.
		// We prove it (a) returns the 413 fail and (b) cancels the stream near the
		// cap - never pulling the whole (here effectively unbounded) body.
		const chunkSize = 1_000_000;
		let pulls = 0;
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulls += 1;
				if (pulls > (MAX_UPLOAD_BYTES / chunkSize) * 4) {
					controller.close();
					return;
				}
				controller.enqueue(new Uint8Array(chunkSize));
			},
			cancel() {
				cancelled = true;
			}
		});
		const request = new Request('http://localhost/data-sets?/upload', {
			method: 'POST',
			headers: { 'content-type': 'multipart/form-data; boundary=----acta' },
			body,
			duplex: 'half'
		} as RequestInit & { duplex: 'half' });

		const result = await actions.upload(event(request));

		expect(result).toMatchObject({
			status: 413,
			data: { message: 'File exceeds the 50 MB upload limit.' }
		});
		expect(cancelled).toBe(true);
		// Stopped at the cap: the multipart body was never fully buffered, and the
		// ingestion service was never reached.
		expect(pulls).toBeLessThanOrEqual(MAX_UPLOAD_BYTES / chunkSize + 2);
		expect(ingestFileMock).not.toHaveBeenCalled();
	});

	it('rejects an over-cap Content-Length before reading the body', async () => {
		const request = new Request('http://localhost/data-sets?/upload', {
			method: 'POST',
			headers: {
				'content-type': 'multipart/form-data; boundary=----acta',
				'content-length': String(MAX_UPLOAD_BYTES + 1)
			},
			body: '----acta',
			duplex: 'half'
		} as RequestInit & { duplex: 'half' });

		const result = await actions.upload(event(request));

		expect(result).toMatchObject({ status: 413 });
		expect(ingestFileMock).not.toHaveBeenCalled();
	});

	it('fails 400 when no file field is present', async () => {
		const form = new FormData();
		form.set('notafile', 'x');
		const request = new Request('http://localhost/data-sets?/upload', {
			method: 'POST',
			body: form
		});

		const result = await actions.upload(event(request));

		expect(result).toMatchObject({ status: 400 });
		expect(ingestFileMock).not.toHaveBeenCalled();
	});
});
