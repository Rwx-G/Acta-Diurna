import { z } from 'zod';
import { audiencesSchema, idSchema } from './shared.ts';

/**
 * Narrative content is data, never HTML (XSS rule, architecture cross-cutting
 * concern 2). Inline runs carry the only formatting the renderer honors;
 * links are restricted to http(s) so no scriptable URL ever enters a document.
 */
export const inlineRunSchema = z.object({
	text: z.string(),
	bold: z.boolean().optional(),
	italic: z.boolean().optional(),
	link: z
		.object({
			href: z.url({ protocol: /^https?$/, error: 'Links must use an http(s) URL.' })
		})
		.optional()
});

export type InlineRun = z.infer<typeof inlineRunSchema>;

/** A paragraph is an ordered list of inline runs. */
export const paragraphSchema = z.array(inlineRunSchema);

export type Paragraph = z.infer<typeof paragraphSchema>;

export const textBlockSchema = z.object({
	type: z.literal('text'),
	id: idSchema,
	audiences: audiencesSchema.optional(),
	paragraphs: z.array(paragraphSchema)
});

export type TextBlock = z.infer<typeof textBlockSchema>;
