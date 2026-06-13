/**
 * The form-action companion to `runApi` ($lib/server/api). A workspace action
 * throws (or its service throws) an AppError; this catches it and maps it to a
 * SvelteKit `fail(status, shape)` with a CONSISTENT problem shape, so every
 * action returns the same well-typed failure surface instead of copy-pasting
 * the `catch (AppError) -> fail(...)` block at every call site.
 *
 * WHY a per-action `shape` callback rather than a fixed payload: actions return
 * differently-keyed `fail` payloads (`{message, errors}`, `{generate: {...}}`,
 * `{sent, message}`, `{ai: {...}}`). The helper owns the catch discipline and
 * the normalized {status, message, errors} it derives from the AppError; the
 * call site owns how that maps onto ITS keys. A non-AppError (and a redirect()
 * throw, which is not an AppError) propagates untouched so SvelteKit's redirect
 * and the unexpected-500 path still own it.
 */
import { fail } from '@sveltejs/kit';
import { AppError, type ProblemFieldError } from '$lib/server/problem';

/** The normalized failure an AppError maps to before a call site keys it. */
export interface ActionProblem {
	status: number;
	message: string;
	errors: ProblemFieldError[];
}

export async function runAction<TSuccess, TFailure>(
	body: () => Promise<TSuccess>,
	shape: (problem: ActionProblem) => TFailure
): Promise<TSuccess | ReturnType<typeof fail<TFailure>>> {
	try {
		return await body();
	} catch (thrown) {
		if (thrown instanceof AppError) {
			const problem: ActionProblem = {
				status: thrown.status,
				message: thrown.detail ?? thrown.title,
				errors: thrown.errors ?? []
			};
			return fail(problem.status, shape(problem));
		}
		throw thrown;
	}
}
