/**
 * The streaming byte-cap shared by BOTH ingestion entries (the 4.3 API push and
 * the 2.4 upload form). Reads a request body's stream one chunk at a time,
 * checking the cumulative byte count after each chunk, and the instant it
 * exceeds `MAX_UPLOAD_BYTES` it cancels the reader and throws the 413 - so an
 * oversized body is NEVER fully buffered (the DoS guard). Extracted here so the
 * two entries cannot drift: the cap is enforced in one place, before any parse.
 */
import { MAX_UPLOAD_BYTES } from './ingestion.ts';
import { tooLarge } from './errors.ts';

/**
 * Reads `stream` into a single `Uint8Array`, aborting at `MAX_UPLOAD_BYTES`.
 *
 * Pulls chunks one at a time and sums their lengths; the moment the running
 * total exceeds the cap the reader is cancelled (so the remaining, potentially
 * unbounded, body is never pulled into memory) and `tooLarge` is thrown. The
 * caller decides what an empty result means - this helper returns the assembled
 * bytes (zero-length when the body was empty) and does not impose a 400.
 */
export async function readStreamToCap(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value === undefined) continue;
			total += value.byteLength;
			if (total > MAX_UPLOAD_BYTES) {
				// Stop AT the cap: cancel the stream so the remaining (potentially
				// unbounded) body is never pulled into memory.
				await reader.cancel();
				throw tooLarge(MAX_UPLOAD_BYTES);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}
