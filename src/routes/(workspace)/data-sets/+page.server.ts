import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { resolveAuthorScope } from '$lib/server/authors';
import { performLogout } from '$lib/server/auth/logout';
import { ingestFile, listDataSets, MAX_UPLOAD_BYTES, readStreamToCap } from '$lib/server/ingestion';
import { tooLarge } from '$lib/server/ingestion/errors';
import { AppError } from '$lib/server/problem';

export const load: PageServerLoad = async () => {
	return { dataSets: await listDataSets(await resolveAuthorScope()) };
};

/**
 * Reads the multipart upload request, enforcing the `MAX_UPLOAD_BYTES` cap by
 * STREAMING the raw body and aborting the instant it exceeds the cap (the 4.3
 * API-push guard, now at parity) - so an oversized multipart body is never fully
 * buffered. The raw body's `Content-Length` is the cheap fast-path early
 * rejection; the streaming read is the real bound. Only once the body is bounded
 * is it re-read as multipart `FormData` (the boundary header is preserved). An
 * over-cap upload throws `tooLarge`, surfaced as the existing 413 `fail` shape.
 */
async function readCappedFormData(request: Request): Promise<FormData> {
	const declared = request.headers.get('content-length');
	if (declared !== null) {
		const length = Number(declared);
		if (Number.isFinite(length) && length > MAX_UPLOAD_BYTES) {
			throw tooLarge(MAX_UPLOAD_BYTES);
		}
	}
	// No body means no fields; the standard parse yields an empty FormData.
	if (request.body === null) return request.formData();
	const bytes = await readStreamToCap(request.body);
	// Re-wrap the bounded bytes as a fresh response so `.formData()` parses the
	// multipart payload against the original `Content-Type` boundary. The slice
	// gives a plain ArrayBuffer (a Uint8Array's backing buffer is ArrayBufferLike,
	// not a BodyInit under strict lib types - the same copy `ingestBytes` makes).
	return new Response(bytes.slice().buffer, {
		headers: { 'content-type': request.headers.get('content-type') ?? '' }
	}).formData();
}

export const actions: Actions = {
	upload: async ({ request }) => {
		let data: FormData;
		try {
			data = await readCappedFormData(request);
		} catch (thrown) {
			if (thrown instanceof AppError) {
				return fail(thrown.status, { message: thrown.detail ?? thrown.title });
			}
			throw thrown;
		}
		const file = data.get('file');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { message: 'Choose a file to upload.' });
		}
		try {
			const dataSet = await ingestFile({ file, scope: await resolveAuthorScope() });
			return { uploaded: { id: dataSet.id, filename: dataSet.filename } };
		} catch (thrown) {
			if (thrown instanceof AppError) {
				return fail(thrown.status, { message: thrown.detail ?? thrown.title });
			}
			throw thrown;
		}
	},
	logout: async ({ cookies }) => {
		await performLogout(cookies);
		redirect(303, '/login');
	}
};
