import { z } from 'zod';
import { idSchema } from '../blocks/shared.ts';
import { sectionSchema } from '../blocks/section.ts';

/** Document schema, version 1. The published contract (FR31, architecture D3). */
export const documentSchemaV1 = z.object({
	version: z.literal(1, 'Unsupported document schema version.'),
	title: z
		.string()
		.min(1, 'A document needs a title.')
		.max(300, 'Document title too long: 300 characters maximum.'),
	theme: idSchema.optional(),
	sections: z
		.array(sectionSchema)
		.min(1, 'A document must contain at least one section.')
		.max(100, 'Too many sections: 100 maximum.')
});

/** Parsed document (output side: defaults applied). */
export type DocumentV1 = z.output<typeof documentSchemaV1>;

/** Document as producers write it (input side: defaulted fields optional). */
export type DocumentV1Input = z.input<typeof documentSchemaV1>;
