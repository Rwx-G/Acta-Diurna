import { z } from 'zod';
import { audiencesSchema, idSchema } from './shared.ts';
import { chartBlockSchema } from './chart.ts';
import { imageBlockSchema } from './image.ts';
import { kpiBlockSchema } from './kpi.ts';
import { tableBlockSchema } from './table.ts';
import { textBlockSchema } from './text.ts';

/** The five v1 block types, discriminated on `type`. */
export const blockSchema = z.discriminatedUnion('type', [
	textBlockSchema,
	tableBlockSchema,
	chartBlockSchema,
	kpiBlockSchema,
	imageBlockSchema
]);

export type Block = z.infer<typeof blockSchema>;

export type BlockType = Block['type'];

export const sectionSchema = z.object({
	id: idSchema,
	title: z.string().min(1, 'A section needs a title.'),
	audiences: audiencesSchema.optional(),
	annex: z.boolean().optional(),
	blocks: z.array(blockSchema).min(1, 'A section must contain at least one block.')
});

export type Section = z.infer<typeof sectionSchema>;
