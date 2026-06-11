import { z } from 'zod';
import { audiencesSchema, idSchema } from './shared.ts';

/**
 * Images reference uploaded assets only; remote URLs are rejected by design
 * (CSP, no phone-home). `alt` is required for accessibility (AAA target on
 * report content).
 */
export const imageBlockSchema = z.object({
	type: z.literal('image'),
	id: idSchema,
	audiences: audiencesSchema.optional(),
	assetId: z.uuid('Must be the UUID of an uploaded asset.'),
	alt: z
		.string()
		.min(1, 'Alt text must not be empty.')
		.max(500, 'Alt text too long: 500 characters maximum.'),
	caption: z.string().min(1).max(500, 'Caption too long: 500 characters maximum.').optional()
});

export type ImageBlock = z.infer<typeof imageBlockSchema>;
