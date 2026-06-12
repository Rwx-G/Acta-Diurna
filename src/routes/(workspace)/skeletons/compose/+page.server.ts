import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import { AppError } from '$lib/server/problem';
import { saveSkeleton } from '$lib/server/skeletons/skeletons';

export const actions: Actions = {
	save: async ({ request }) => {
		const data = await request.formData();
		const raw = data.get('document');
		if (typeof raw !== 'string') {
			// The composer always posts the serialized structure with JS; a missing
			// payload means a no-JS post, which the structure-first composer does not
			// support (workspace is desktop-only, JS-required - 1.5 accepted gap).
			return fail(400, { message: 'Composing a skeleton requires JavaScript.', errors: [] });
		}
		let structureInput: unknown;
		try {
			structureInput = JSON.parse(raw);
		} catch {
			return fail(400, { message: 'Malformed skeleton payload.', errors: [] });
		}
		try {
			const skeleton = saveSkeleton(structureInput);
			return { savedName: skeleton.name };
		} catch (thrown) {
			if (thrown instanceof AppError) {
				return fail(thrown.status, {
					message: thrown.detail ?? thrown.title,
					errors: thrown.errors ?? []
				});
			}
			throw thrown;
		}
	}
};
