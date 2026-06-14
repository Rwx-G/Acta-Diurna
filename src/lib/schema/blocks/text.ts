import { z } from 'zod';
import { audiencesSchema, idSchema } from './shared.ts';

/**
 * Narrative content is data, never HTML (XSS rule, architecture cross-cutting
 * concern 2). Inline runs carry the only formatting the renderer honors;
 * links are restricted to http(s) so no scriptable URL ever enters a document.
 * The `code` mark (Story 7.8) renders the run as an escaped monospace chip
 * (a `<code>` span), the inline twin of the code block - additive, so a run
 * without it renders exactly as before.
 *
 * `linkTo` (Epic 11, Story 11.2) is the internal-link twin of the external
 * `link.href`: it carries a SECTION ID in the same document (a slug), rendered
 * as an in-page anchor (`#<section-id>`), never a URL. A run links internally
 * (`linkTo`) OR externally (`link.href`), never both - the mutual exclusion is
 * the section-local refine below. The target section's existence is checked in
 * the document-level cross-reference pass (`validateInternalLinks`), because a
 * run cannot see the document's section ids from inside its own schema.
 * Additive and optional: a run without `linkTo` renders byte-unchanged.
 */
export const inlineRunSchema = z
	.object({
		text: z.string().max(5000, 'Run text too long: 5000 characters maximum.'),
		bold: z.boolean().optional(),
		italic: z.boolean().optional(),
		code: z.boolean().optional(),
		link: z
			.object({
				href: z
					.url({ protocol: /^https?$/, error: 'Links must use an http(s) URL.' })
					.max(2000, 'Link URL too long: 2000 characters maximum.')
			})
			.optional(),
		linkTo: idSchema.optional()
	})
	.superRefine((run, ctx) => {
		// A run links internally (`linkTo`) OR externally (`link.href`), never both:
		// the two carry incompatible navigation (an in-page anchor vs an http(s)
		// URL), so a run setting both has no coherent target. Section-local (both
		// fields live on the same run), so no document context is needed (FR2 parity).
		if (run.linkTo !== undefined && run.link !== undefined) {
			ctx.addIssue({
				code: 'custom',
				message:
					'A run sets both an internal linkTo and an external link, but the two are mutually exclusive.',
				path: ['linkTo'],
				params: {
					hint: 'A run links internally (linkTo a section id) OR externally (link.href), never both. Drop one.'
				}
			});
		}
	});

export type InlineRun = z.infer<typeof inlineRunSchema>;

/** A paragraph is an ordered list of inline runs. */
export const paragraphSchema = z
	.array(inlineRunSchema)
	.max(200, 'Too many runs in a paragraph: 200 maximum.');

export type Paragraph = z.infer<typeof paragraphSchema>;

export const textBlockSchema = z.object({
	type: z.literal('text'),
	id: idSchema,
	audiences: audiencesSchema.optional(),
	paragraphs: z
		.array(paragraphSchema)
		.min(1, 'A text block must contain at least one paragraph.')
		.max(500, 'Too many paragraphs: 500 maximum.')
});

export type TextBlock = z.infer<typeof textBlockSchema>;
