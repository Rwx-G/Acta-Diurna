import type { z } from 'zod';
import { SUPPORTED_VERSIONS } from './versions/index.ts';
import { documentSchemaV1, type DocumentV1 } from './versions/v1.ts';

/**
 * One actionable validation error (FR2/FR15). The same shape feeds the
 * `errors` array of RFC 9457 problem details (architecture D9), binding
 * diagnostics (Epic 2) and the editor's inline messages (story 1.5).
 */
export interface ValidationErrorDetail {
	/** Human-readable location, e.g. `sections[2].blocks[0].alt`. `document` for root issues. */
	path: string;
	message: string;
	hint?: string;
}

export type DocumentValidationResult =
	| { ok: true; document: DocumentV1 }
	| { ok: false; errors: ValidationErrorDetail[] };

/** RFC 9457 problem details for a failed document validation. */
export interface ValidationProblemDetails {
	type: string;
	title: string;
	status: number;
	detail: string;
	errors: ValidationErrorDetail[];
}

/**
 * Error map passed at parse time. Schema-level messages take precedence, so
 * this only rewrites the generic cases: zod reports a missing required key as
 * `invalid_type` with `undefined` input, which deserves a clearer message.
 */
export const documentErrorMap: z.core.$ZodErrorMap = (issue) => {
	if (issue.code === 'invalid_type' && issue.input === undefined) {
		return `Missing required field: expected ${issue.expected}.`;
	}
	return undefined;
};

/** Formats a zod issue path as a human-readable pointer, e.g. `sections[2].blocks[0].alt`. */
export function formatIssuePath(path: ReadonlyArray<PropertyKey>): string {
	if (path.length === 0) {
		return 'document';
	}
	let formatted = '';
	for (const segment of path) {
		if (typeof segment === 'number') {
			formatted += `[${segment}]`;
		} else {
			formatted += formatted === '' ? String(segment) : `.${String(segment)}`;
		}
	}
	return formatted;
}

const FIELD_HINTS: Record<string, string> = {
	alt: 'Describe the image for screen readers; alt text is required on every image block.',
	assetId: 'Reference an uploaded asset by its UUID; remote image URLs are not supported.'
};

const ARRAY_HINTS: Record<string, string> = {
	sections: 'A document needs at least one section.',
	blocks: 'A section needs at least one block.'
};

function lastFieldName(path: ReadonlyArray<PropertyKey>): string | undefined {
	for (let index = path.length - 1; index >= 0; index -= 1) {
		const segment = path[index];
		if (typeof segment === 'string') {
			return segment;
		}
	}
	return undefined;
}

function hintForIssue(issue: z.core.$ZodIssue): string | undefined {
	if (issue.code === 'custom') {
		const hint = issue.params?.['hint'];
		return typeof hint === 'string' ? hint : undefined;
	}
	const field = lastFieldName(issue.path);
	if (field !== undefined && field in FIELD_HINTS) {
		return FIELD_HINTS[field];
	}
	switch (issue.code) {
		case 'invalid_union':
			if (issue.discriminator !== undefined && 'options' in issue && issue.options !== undefined) {
				return `Valid block types: ${issue.options.map(String).join(', ')}.`;
			}
			return undefined;
		case 'invalid_value':
			if (field === 'version') {
				return `Supported document schema versions: ${SUPPORTED_VERSIONS.join(', ')}.`;
			}
			return `Allowed values: ${issue.values.map(String).join(', ')}.`;
		case 'too_small':
			if (issue.origin === 'array') {
				return (
					(field !== undefined ? ARRAY_HINTS[field] : undefined) ??
					`Provide at least ${issue.minimum} item(s).`
				);
			}
			if (issue.origin === 'string') {
				return 'Provide a non-empty value.';
			}
			return undefined;
		case 'invalid_type':
			return `Provide a value of type ${issue.expected}.`;
		case 'invalid_format':
			switch (issue.format) {
				case 'url':
					return 'Use an absolute http(s) URL.';
				case 'uuid':
					return 'Use a UUID, e.g. 0197b3a0-5c6e-7c2a-9f4d-2b8e6a1d3c5f.';
				case 'regex':
					return 'Use lowercase letters, digits and single hyphens, e.g. executive-summary.';
				default:
					return undefined;
			}
		default:
			return undefined;
	}
}

/** Flattens a `ZodError` into actionable `{path, message, hint?}` entries. */
export function toValidationErrors(error: z.ZodError): ValidationErrorDetail[] {
	return error.issues.map((issue) => {
		const hint = hintForIssue(issue);
		return {
			path: formatIssuePath(issue.path),
			message: issue.message,
			...(hint === undefined ? {} : { hint })
		};
	});
}

/**
 * Validates an untrusted value against the current document schema.
 * THE contract every consumer uses: editor saves, API writes, agent payloads.
 */
export function validateDocument(input: unknown): DocumentValidationResult {
	const result = documentSchemaV1.safeParse(input, { error: documentErrorMap });
	if (result.success) {
		return { ok: true, document: result.data };
	}
	return { ok: false, errors: toValidationErrors(result.error) };
}

/** Shapes validation errors as an RFC 9457 problem-details body (architecture D9). */
export function toProblemDetails(errors: ValidationErrorDetail[]): ValidationProblemDetails {
	return {
		type: '/problems/document-validation',
		title: 'Document validation failed',
		status: 422,
		detail:
			errors.length === 1
				? '1 validation error found in the document.'
				: `${errors.length} validation errors found in the document.`,
		errors
	};
}
