import { describe, expect, it } from 'vitest';
import { AppError } from '$lib/server/problem';
import { MAX_UPLOAD_BYTES } from './ingestion.ts';
import { readStreamToCap } from './stream.ts';

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
	let i = 0;
	return new ReadableStream<Uint8Array>({
		pull(controller) {
			if (i >= chunks.length) {
				controller.close();
				return;
			}
			controller.enqueue(chunks[i]);
			i += 1;
		}
	});
}

describe('readStreamToCap', () => {
	it('assembles the chunks into a single buffer within the cap', async () => {
		const bytes = await readStreamToCap(
			streamOf([new TextEncoder().encode('a,b\n'), new TextEncoder().encode('1,2')])
		);
		expect(new TextDecoder().decode(bytes)).toBe('a,b\n1,2');
	});

	it('returns an empty buffer for an empty stream (the caller decides what empty means)', async () => {
		const bytes = await readStreamToCap(streamOf([]));
		expect(bytes.byteLength).toBe(0);
	});

	it('aborts with 413 once cumulative bytes exceed the cap, without buffering it all', async () => {
		// A stream that would yield far more than the cap (one 1 MB chunk per pull).
		// The abort must stop AT the cap: we assert it (a) throws 413 and (b) cancels
		// the reader before pulling the whole (here, effectively unbounded) body -
		// proved by `cancelled` flipping and the pull count staying near the cap.
		const chunkSize = 1_000_000;
		let pulls = 0;
		let cancelled = false;
		const stream = new ReadableStream<Uint8Array>({
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

		await expect(readStreamToCap(stream)).rejects.toMatchObject({ status: 413 });
		expect(cancelled).toBe(true);
		// Stopped at the cap, nowhere near the runaway pull count.
		expect(pulls).toBeLessThanOrEqual(MAX_UPLOAD_BYTES / chunkSize + 2);
	});

	it('throws the upload-too-large AppError type at the cap', async () => {
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.enqueue(new Uint8Array(MAX_UPLOAD_BYTES + 1));
				controller.close();
			}
		});
		try {
			await readStreamToCap(stream);
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(AppError);
			expect((error as AppError).type).toBe('/problems/upload-too-large');
		}
	});
});
