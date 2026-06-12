import { z } from 'zod';
import { audiencesSchema, idSchema } from './shared.ts';
import { paragraphSchema } from './text.ts';

/**
 * Timeline / Roadmap block (Epic 7, Story 7.11): an ordered sequence of
 * milestones, each carrying a `label`, an optional `date`/phase sub-label, an
 * optional rich-text `detail`, and a `status` that resolves its colour and
 * label from a document scale entry - the SAME resolution the chip-cluster, the
 * legend and the table scaleRef column use, so an action plan or roadmap reads
 * as a sequence rather than a status table. The milestones render in their
 * declared order: the schema carries no per-milestone position number, so
 * reordering a milestone is reordering the array.
 *
 * The `status` is a `{ scaleRef, entry }` pair (per milestone, not one scale
 * for the whole block as the chip-cluster does): a milestone references a scale
 * by key and one of its entries by key, so two milestones can carry statuses
 * from different scales. The shared status Badge (7.5) renders that entry as a
 * pill with its colour and label, the label text ALWAYS present so colour is
 * never the sole signal (NFR14).
 *
 * The `detail` reuses the text block's rich-text vocabulary (paragraphs of
 * inline runs), the SAME marks the text, callout and list blocks honour -
 * bold/italic, the 7.8 inline-code chip, and http(s) links - so the detail
 * renders escaped with no raw HTML.
 *
 * Isomorphic by design: this module imports nothing from `$lib/server` or
 * `$lib/ui`. The block validates its own shape here; the cross-reference of each
 * milestone `status.scaleRef` and `status.entry` against the document `scales`
 * happens in the document-level pass (`scales.ts` `validateScaleReferences`),
 * because a block cannot see the document `scales` from inside the discriminated
 * union.
 */

/**
 * DoS cap on milestones. A roadmap past 50 milestones is a structural smell
 * (split it into phases or sections), and the bound keeps a single block's SSR
 * bounded.
 */
export const MAX_MILESTONES = 50;

/** DoS cap on the rich-text detail, mirroring the callout and list-item ceilings. */
export const MAX_MILESTONE_DETAIL_PARAGRAPHS = 50;

/**
 * A milestone's status: a document `scales` key plus one of that scale's entry
 * keys. Both are cross-referenced against the document `scales` in the
 * document-level pass; the Badge resolves the entry's colour and label.
 */
export const milestoneStatusSchema = z.object({
	scaleRef: idSchema,
	entry: idSchema
});

export type MilestoneStatus = z.infer<typeof milestoneStatusSchema>;

export const milestoneSchema = z.object({
	// The milestone heading, always present.
	label: z
		.string()
		.min(1, 'A milestone needs a label.')
		.max(300, 'Milestone label too long: 300 characters maximum.'),
	// An optional free-form date or phase sub-label (e.g. "Q3 2026", "2026-06-12",
	// "Phase 1"). Free text, NOT a parsed date: a roadmap mixes calendar dates and
	// phase names, so the renderer shows it verbatim under the label.
	date: z.string().min(1).max(120, 'Milestone date too long: 120 characters maximum.').optional(),
	// The optional rich-text detail: paragraphs of inline runs, the SAME vocabulary
	// the text, callout and list blocks use, so the detail renders escaped.
	detail: z
		.array(paragraphSchema)
		.min(1, 'A milestone detail needs at least one paragraph.')
		.max(MAX_MILESTONE_DETAIL_PARAGRAPHS, 'Too many paragraphs in a milestone detail: 50 maximum.')
		.optional(),
	// The milestone status: a scale entry reference (resolved in the document-level
	// pass), rendered as a status Badge.
	status: milestoneStatusSchema
});

export type Milestone = z.infer<typeof milestoneSchema>;

export const timelineBlockSchema = z.object({
	type: z.literal('timeline'),
	id: idSchema,
	audiences: audiencesSchema.optional(),
	// Optional heading for the timeline.
	title: z.string().min(1).max(200, 'Timeline title too long: 200 characters maximum.').optional(),
	milestones: z
		.array(milestoneSchema)
		.min(1, 'A timeline needs at least one milestone.')
		.max(MAX_MILESTONES, 'Too many milestones: 50 maximum.')
});

export type TimelineBlock = z.infer<typeof timelineBlockSchema>;
