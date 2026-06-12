import { z } from 'zod';
import { audiencesSchema, idSchema } from './shared.ts';

/**
 * Code block (Epic 7, Story 7.8): a static, selectable monospace `<pre>` for
 * commands, snippets and literal source in technical reports. The `code` field
 * is the LITERAL source string, rendered escaped with whitespace and newlines
 * preserved - never raw HTML, never executed, so a snippet reading "<script>"
 * shows as visible text (the renderer-purity guarantee, cross-cutting concern 2).
 *
 * `language?` is a free-form short CAPTION label (e.g. `bash`, `sql`, `json`),
 * NOT a highlighter directive: the renderer shows it as a small caption and does
 * no syntax highlighting (no highlighter library, no new dependency). `annotations?`
 * is an optional list of short escaped notes, each optionally tied to a 1-based
 * line number, rendered as adjacent escaped text beside the code.
 *
 * The block ships NO copy-to-clipboard button: a copy affordance needs client JS
 * and would move the reader JS budget (NFR3). The block is a selectable static
 * `<pre>` only (Phase B foundational design - zero hydration). An additive member
 * of the block union: a schema-v1 document without it validates unchanged.
 *
 * Isomorphic by design: this module imports nothing from `$lib/server` or
 * `$lib/ui`.
 */

/** DoS cap on the literal source length. */
export const MAX_CODE_LENGTH = 20000;

/** DoS cap on the number of source lines (a long single line is bounded by the length cap). */
export const MAX_CODE_LINES = 500;

/** DoS cap on the number of annotations attached to one code block. */
export const MAX_CODE_ANNOTATIONS = 100;

/**
 * One short note on the code: a required escaped `text` and an optional 1-based
 * `line` tying it to a source line (a trailing/general note carries no line).
 */
export const codeAnnotationSchema = z.object({
	line: z
		.number()
		.int('Annotation line must be a whole number.')
		.min(1, 'Annotation line must be 1 or greater.')
		.optional(),
	text: z
		.string()
		.min(1, 'An annotation needs text.')
		.max(280, 'Annotation too long: 280 characters maximum.')
});

export type CodeAnnotation = z.infer<typeof codeAnnotationSchema>;

export const codeBlockSchema = z.object({
	type: z.literal('code'),
	id: idSchema,
	audiences: audiencesSchema.optional(),
	// The literal source. Rendered escaped with whitespace/newlines preserved,
	// never raw HTML, never executed.
	code: z
		.string()
		.max(MAX_CODE_LENGTH, 'Code too long: 20000 characters maximum.')
		.refine(
			(value) => value.split('\n').length <= MAX_CODE_LINES,
			'Too many lines of code: 500 maximum.'
		),
	// A free-form short caption (e.g. `bash`, `sql`). Shown as a caption only, never
	// a highlighter directive.
	language: z.string().min(1).max(40, 'Language label too long: 40 characters maximum.').optional(),
	// Optional short escaped notes, each optionally tied to a 1-based source line.
	annotations: z
		.array(codeAnnotationSchema)
		.max(MAX_CODE_ANNOTATIONS, 'Too many annotations: 100 maximum.')
		.optional()
});

export type CodeBlock = z.infer<typeof codeBlockSchema>;
