import { z } from 'zod';
import { audiencesSchema, idSchema } from './shared.ts';

/**
 * Chip-cluster block (Epic 7, Story 7.5): a wrapped row of status pills, each
 * resolving its colour and label from a single referenced document scale - the
 * same resolution the legend and the comparison-matrix pills use. The block
 * names the scale once (`scaleRef`) and lists the entry keys to render
 * (`entries`); colour and label are NEVER authored on the block. The label text
 * is always present, so colour is never the sole signal (NFR14).
 *
 * Isomorphic by design: imports nothing from `$lib/server` or `$lib/ui`. The
 * block validates its own shape here; the cross-reference of `scaleRef` and each
 * entry key against the document `scales` happens in the document-level pass
 * (`scales.ts` `validateScaleReferences`), because a block cannot see the
 * document `scales` from inside the discriminated union.
 */

/**
 * DoS cap on the pills in one cluster. Bounded by the referenced scale's entries
 * (`MAX_SCALE_ENTRIES = 24`) in practice, but a cluster may repeat an entry, so
 * cap independently to keep SSR bounded.
 */
export const MAX_CHIPS = 64;

export const chipClusterBlockSchema = z.object({
	type: z.literal('chip-cluster'),
	id: idSchema,
	audiences: audiencesSchema.optional(),
	// A document `scales` key (resolved in the document-level pass). Every chip in
	// the cluster resolves against this one scale; the block carries no colour or
	// label of its own.
	scaleRef: idSchema,
	// The scale entry keys to render, in order. Each must be an entry of the
	// referenced scale (checked in the document-level pass).
	entries: z
		.array(idSchema)
		.min(1, 'A chip cluster needs at least one entry.')
		.max(MAX_CHIPS, 'Too many chips: 64 maximum.'),
	// Optional heading for the cluster.
	title: z
		.string()
		.min(1)
		.max(200, 'Chip-cluster title too long: 200 characters maximum.')
		.optional()
});

export type ChipClusterBlock = z.infer<typeof chipClusterBlockSchema>;
