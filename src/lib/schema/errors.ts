import type { z } from 'zod';
import {
	documentSchemaV1,
	getSchema,
	isSupportedVersion,
	SUPPORTED_VERSIONS,
	type DocumentV1
} from './versions/index.ts';
import {
	migrateToVersion,
	MigrationPathError,
	type DocumentMigration
} from './versions/migrations.ts';

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

/** Issue-code-specific hints. The generic expected-type case lives in {@link hintForIssue}. */
function hintForCode(issue: z.core.$ZodIssue): string | undefined {
	switch (issue.code) {
		case 'invalid_union':
			if (issue.discriminator !== undefined && 'options' in issue && issue.options !== undefined) {
				return `Valid block types: ${issue.options.map(String).join(', ')}.`;
			}
			return undefined;
		case 'invalid_value':
			return `Allowed values: ${issue.values.map(String).join(', ')}.`;
		case 'too_small':
			if (issue.origin === 'array') {
				const field = lastFieldName(issue.path);
				return (
					(field !== undefined ? ARRAY_HINTS[field] : undefined) ??
					`Provide at least ${issue.minimum} item(s).`
				);
			}
			if (issue.origin === 'string') {
				return 'Provide a non-empty value.';
			}
			return undefined;
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

/**
 * Hint precedence: custom-issue `params.hint` > issue-code hint > field hint.
 * The generic expected-type hint ranks below field hints because it carries
 * the least information (a missing `alt` deserves the accessibility hint, not
 * "provide a string").
 */
function hintForIssue(issue: z.core.$ZodIssue): string | undefined {
	if (issue.code === 'custom') {
		const hint = issue.params?.['hint'];
		return typeof hint === 'string' ? hint : undefined;
	}
	const codeHint = hintForCode(issue);
	if (codeHint !== undefined) {
		return codeHint;
	}
	const field = lastFieldName(issue.path);
	if (field !== undefined && field in FIELD_HINTS) {
		return FIELD_HINTS[field];
	}
	if (issue.code === 'invalid_type') {
		return `Provide a value of type ${issue.expected}.`;
	}
	return undefined;
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

const SUPPORTED_VERSIONS_HINT = `Supported document schema versions: ${SUPPORTED_VERSIONS.join(', ')}.`;

function versionError(message: string): DocumentValidationResult {
	return { ok: false, errors: [{ path: 'version', message, hint: SUPPORTED_VERSIONS_HINT }] };
}

function parseWith(schema: typeof documentSchemaV1, input: unknown): DocumentValidationResult {
	const result = schema.safeParse(input, { error: documentErrorMap });
	if (result.success) {
		return { ok: true, document: result.data };
	}
	return { ok: false, errors: toValidationErrors(result.error) };
}

/**
 * Validates an untrusted value against the document schema matching its
 * declared `version`, routed through the version registry (FR7). A missing or
 * unsupported version yields a single actionable error carrying the supported
 * range. THE contract every consumer uses: editor saves, API writes, agent
 * payloads.
 */
export function validateDocument(input: unknown): DocumentValidationResult {
	if (typeof input !== 'object' || input === null || Array.isArray(input)) {
		// Not a candidate document at all: let the schema report the root-level
		// type error with the standard `document` path.
		return parseWith(documentSchemaV1, input);
	}
	const version: unknown = (input as Record<string, unknown>)['version'];
	if (version === undefined) {
		return versionError('Missing document schema version.');
	}
	if (typeof version !== 'number' || !isSupportedVersion(version)) {
		return versionError('Unsupported document schema version.');
	}
	return parseWith(getSchema(version), input);
}

/**
 * Validates a STORED document for rendering, lifting an earlier supported
 * version forward through the migration chain first (FR7, N/N-1). This is the
 * render-path contract: a document persisted under schema v(N-1) is migrated to
 * the current shape, then validated, so the renderer only ever sees a
 * current-version `DocumentV1`. An unsupported version (no migration path)
 * yields the same actionable `version` error as {@link validateDocument},
 * naming the supported range - rendered as a neutral error state, never a crash.
 *
 * `migrations` is injectable purely so the N-1 mechanism can be exercised by a
 * synthetic v0 fixture in tests; production callers use the default registry.
 */
export function validateStoredDocument(
	input: unknown,
	migrations?: readonly DocumentMigration[]
): DocumentValidationResult {
	if (typeof input !== 'object' || input === null || Array.isArray(input)) {
		return parseWith(documentSchemaV1, input);
	}
	let migrated: Record<string, unknown>;
	try {
		migrated = migrateToVersion(input as Record<string, unknown>, undefined, migrations);
	} catch (thrown) {
		if (thrown instanceof MigrationPathError) {
			return versionError('Unsupported document schema version.');
		}
		throw thrown;
	}
	return validateDocument(migrated);
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
