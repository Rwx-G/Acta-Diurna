import { z } from 'zod';
import { audiencesSchema, idSchema } from './shared.ts';

/**
 * Set-Membership (UpSet) block (Epic 7, Story 7.4): an UpSet-style matrix derived
 * from a comparison-matrix block's findings, with ZERO extra data entry. It
 * references that block by id (`sourceBlockId`) and re-enters nothing - every row,
 * pill and dot is derived from the referenced matrix's findings + the document
 * scales (severity for pill colours, sources for the dot/column order).
 *
 * Isomorphic by design: imports nothing from `$lib/server` or `$lib/ui`. The
 * block validates its own shape here; the cross-reference of `sourceBlockId` to a
 * `comparison-matrix` block IN THE SAME DOCUMENT happens in the document-level
 * pass (`scales.ts` `validateScaleReferences`), because a block cannot see its
 * sibling blocks from inside the discriminated union.
 */
export const setMembershipBlockSchema = z.object({
	type: z.literal('set-membership'),
	id: idSchema,
	audiences: audiencesSchema.optional(),
	// The id of a `comparison-matrix` block in the SAME document. Resolved in the
	// document-level pass: a dangling id, or an id pointing at a block that is not
	// a comparison-matrix, is an FR2 problem-details error.
	sourceBlockId: idSchema,
	// Optional heading for the UpSet matrix. No data of its own.
	title: z
		.string()
		.min(1)
		.max(300, 'Set-membership title too long: 300 characters maximum.')
		.optional()
});

export type SetMembershipBlock = z.infer<typeof setMembershipBlockSchema>;
