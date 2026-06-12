import { z } from 'zod';
import { audiencesSchema, idSchema } from './shared.ts';
import { calloutBlockSchema } from './callout.ts';
import { cardGridBlockSchema } from './card-grid.ts';
import { chartBlockSchema } from './chart.ts';
import { chipClusterBlockSchema } from './chip-cluster.ts';
import { codeBlockSchema } from './code.ts';
import { comparisonMatrixBlockSchema } from './comparison-matrix.ts';
import { fieldGridBlockSchema } from './field-grid.ts';
import { imageBlockSchema } from './image.ts';
import { kpiBlockSchema } from './kpi.ts';
import { legendBlockSchema } from './legend.ts';
import { listBlockSchema } from './list.ts';
import { setMembershipBlockSchema } from './set-membership.ts';
import { tableBlockSchema } from './table.ts';
import { textBlockSchema } from './text.ts';

/** The v1 block types, discriminated on `type`. */
export const blockSchema = z.discriminatedUnion('type', [
	textBlockSchema,
	tableBlockSchema,
	chartBlockSchema,
	kpiBlockSchema,
	imageBlockSchema,
	comparisonMatrixBlockSchema,
	fieldGridBlockSchema,
	legendBlockSchema,
	setMembershipBlockSchema,
	chipClusterBlockSchema,
	calloutBlockSchema,
	codeBlockSchema,
	cardGridBlockSchema,
	listBlockSchema
]);

export type Block = z.infer<typeof blockSchema>;

export type BlockType = Block['type'];

export const sectionSchema = z.object({
	id: idSchema,
	title: z
		.string()
		.min(1, 'A section needs a title.')
		.max(300, 'Section title too long: 300 characters maximum.'),
	audiences: audiencesSchema.optional(),
	annex: z.boolean().optional(),
	blocks: z
		.array(blockSchema)
		.min(1, 'A section must contain at least one block.')
		.max(200, 'Too many blocks in a section: 200 maximum.')
});

export type Section = z.infer<typeof sectionSchema>;
