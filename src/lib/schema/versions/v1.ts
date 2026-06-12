import { z } from 'zod';
import { idSchema } from '../blocks/shared.ts';
import { sectionSchema } from '../blocks/section.ts';
import { scalesSchema, validateScaleReferences } from '../scales.ts';

/** Document schema, version 1. The published contract (FR31, architecture D3). */
export const documentSchemaV1 = z
	.object({
		version: z.literal(1, 'Unsupported document schema version.'),
		title: z
			.string()
			.min(1, 'A document needs a title.')
			.max(300, 'Document title too long: 300 characters maximum.'),
		theme: idSchema.optional(),
		// Additive, optional (Epic 7). A document with no `scales` validates and
		// renders unchanged; no schema-version bump.
		scales: scalesSchema.optional(),
		sections: z
			.array(sectionSchema)
			.min(1, 'A document must contain at least one section.')
			.max(100, 'Too many sections: 100 maximum.')
	})
	.superRefine((document, ctx) => {
		// The single document-level cross-reference pass (Epic 7 locus). For 7.1 no
		// block references a scale, so this emits nothing; 7.2/7.3/7.4 extend
		// `validateScaleReferences` and the dangling refs surface here as FR2
		// problem-details errors at save/API time.
		for (const issue of validateScaleReferences(document)) {
			ctx.addIssue({
				code: 'custom',
				message: issue.message,
				path: issue.path,
				params: { hint: issue.hint }
			});
		}
	});

/** Parsed document (output side: defaults applied). */
export type DocumentV1 = z.output<typeof documentSchemaV1>;

/** Document as producers write it (input side: defaulted fields optional). */
export type DocumentV1Input = z.input<typeof documentSchemaV1>;
