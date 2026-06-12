import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { performLogout } from '$lib/server/auth/logout';
import { ingestFile, listDataSets, MAX_UPLOAD_BYTES } from '$lib/server/ingestion';
import { AppError } from '$lib/server/problem';

export const load: PageServerLoad = async () => {
	return { dataSets: await listDataSets() };
};

export const actions: Actions = {
	upload: async ({ request }) => {
		const data = await request.formData();
		const file = data.get('file');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { message: 'Choose a file to upload.' });
		}
		// Cheap pre-check before reading the multipart body into the service, so a
		// grossly oversized upload is rejected with the same 413 the service raises.
		if (file.size > MAX_UPLOAD_BYTES) {
			return fail(413, { message: 'File exceeds the 50 MB upload limit.' });
		}
		try {
			const dataSet = await ingestFile({ file });
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
