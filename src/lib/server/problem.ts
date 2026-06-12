/**
 * Shared error model (D9 / AR4): services throw a typed AppError; a single
 * mapping point turns it into an RFC 9457 `application/problem+json`
 * response (API surfaces) or the App.Error page shape (UI surfaces).
 */

export interface ProblemFieldError {
	path: string;
	message: string;
	hint?: string;
}

export interface AppErrorOptions {
	status: number;
	title: string;
	type?: string;
	detail?: string;
	errors?: ProblemFieldError[];
	/** Extra response headers carried by the error, e.g. Retry-After on 429. */
	headers?: Record<string, string>;
}

export class AppError extends Error {
	readonly status: number;
	readonly title: string;
	readonly type: string;
	readonly detail?: string;
	readonly errors?: ProblemFieldError[];
	readonly headers?: Record<string, string>;

	constructor(options: AppErrorOptions) {
		super(options.detail ?? options.title);
		this.name = 'AppError';
		this.status = options.status;
		this.title = options.title;
		this.type = options.type ?? 'about:blank';
		this.detail = options.detail;
		this.errors = options.errors;
		this.headers = options.headers;
	}
}

/** 429 with a Retry-After hint; constant shape regardless of the caller (NFR9). */
export function rateLimited(retryAfterSeconds: number): AppError {
	return new AppError({
		status: 429,
		title: 'Too Many Requests',
		detail: 'Rate limit exceeded, retry later.',
		headers: { 'Retry-After': String(retryAfterSeconds) }
	});
}

// Only error-semantics headers pass through; everything else is dropped so an
// AppError can never become a header-injection vector (cache, CORS, cookies).
const ALLOWED_ERROR_HEADERS = new Set(['retry-after', 'www-authenticate']);

/** Renders an AppError as an RFC 9457 problem+json HTTP response. */
export function problemResponse(error: AppError): Response {
	const body: Record<string, unknown> = {
		type: error.type,
		title: error.title,
		status: error.status
	};
	if (error.detail !== undefined) body.detail = error.detail;
	if (error.errors !== undefined) body.errors = error.errors;

	const headers = new Headers({ 'content-type': 'application/problem+json' });
	for (const [name, value] of Object.entries(error.headers ?? {})) {
		if (ALLOWED_ERROR_HEADERS.has(name.toLowerCase())) headers.set(name, value);
	}

	return new Response(JSON.stringify(body), { status: error.status, headers });
}

/**
 * Maps an AppError to the SvelteKit error-page shape (App.Error). `message`
 * is required by SvelteKit's ambient type and mirrors `title` as an RFC 9457
 * extension member (same convention as handleError since 1.3).
 */
export function errorPageShape(error: AppError): App.Error {
	return { type: error.type, title: error.title, status: error.status, message: error.title };
}
