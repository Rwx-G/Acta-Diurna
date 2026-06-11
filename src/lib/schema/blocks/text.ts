import { z } from 'zod';
import { audiencesSchema, idSchema } from './shared.ts';

/**
 * Narrative content is data, never HTML (XSS rule, architecture cross-cutting
 * concern 2). Inline runs carry the only formatting the renderer honors;
 * links are restricted to http(s) so no scriptable URL ever enters a document.
 */
export const inlineRunSchema = z.object({
	text: z.string().max(5000, 'Run text too long: 5000 characters maximum.'),
	bold: z.boolean().optional(),
	italic: z.boolean().optional(),
	link: z
		.object({
			href: z
				.url({ protocol: /^https?$/, error: 'Links must use an http(s) URL.' })
				.max(2000, 'Link URL too long: 2000 characters maximum.')
		})
		.optional()
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
