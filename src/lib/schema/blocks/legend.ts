import { z } from 'zod';
import { audiencesSchema, idSchema } from './shared.ts';

/**
 * Legend block (Epic 7, Story 7.3): a source legend that renders one swatch per
 * entry of a referenced document scale. The swatches derive ENTIRELY from the
 * scale - colour, label and optional sublabel - so the legend and the matrix
 * share one colour and label source; no colour or label is re-authored on the
 * block. The whole referenced scale is rendered (every entry), not an
 * author-selected subset.
 *
 * Isomorphic by design: imports nothing from `$lib/server` or `$lib/ui`. The
 * block validates its own shape here; the cross-reference of `scaleRef` against
 * the document `scales` happens in the document-level pass (`scales.ts`
 * `validateScaleReferences`), because a block cannot see the document `scales`
 * from inside the discriminated union.
 */
export const legendBlockSchema = z.object({
	type: z.literal('legend'),
	id: idSchema,
	audiences: audiencesSchema.optional(),
	// A document `scales` key (resolved in the document-level pass). The swatches
	// derive entirely from this scale; the block carries no colour/label of its own.
	scaleRef: idSchema,
	// Optional heading for the legend.
	title: z.string().min(1).max(200, 'Legend title too long: 200 characters maximum.').optional()
});

export type LegendBlock = z.infer<typeof legendBlockSchema>;
