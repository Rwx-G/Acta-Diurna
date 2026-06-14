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
import { timelineBlockSchema } from './timeline.ts';

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
	listBlockSchema,
	timelineBlockSchema
]);

export type Block = z.infer<typeof blockSchema>;

export type BlockType = Block['type'];

export const sectionSchema = z
	.object({
		id: idSchema,
		title: z
			.string()
			.min(1, 'A section needs a title.')
			.max(300, 'Section title too long: 300 characters maximum.'),
		audiences: audiencesSchema.optional(),
		annex: z.boolean().optional(),
		/**
		 * Detail-page placement (Epic 11). Absent (the default) is a normal
		 * main-flow section: in the slide/scroll sequence and in the TOC. `detail`
		 * marks a drill-down page rendered with its stable anchor id but kept OUT of
		 * the main flow AND the TOC, reachable only through an internal link (Story
		 * 11.2/11.3). Additive and optional, so a section without `kind` validates
		 * and renders byte-unchanged - no version bump. Mutually exclusive with
		 * `annex` (see the refine below): a section is main-flow end-matter OR a
		 * detail page, never both.
		 */
		kind: z.literal('detail').optional(),
		/**
		 * Author-only speaker notes (Story 6.2). Surfaced only in the workspace
		 * presenter view; NEVER rendered to a reader and NEVER shipped in a
		 * reader-facing payload (the reader view-model omits it, and the reader-served
		 * document is stripped of it at the publish-serving chokepoint). Additive and
		 * optional, so a section without notes validates unchanged - no version bump.
		 */
		notes: z.string().max(20_000, 'Speaker notes too long: 20000 characters maximum.').optional(),
		blocks: z
			.array(blockSchema)
			.min(1, 'A section must contain at least one block.')
			.max(200, 'Too many blocks in a section: 200 maximum.')
	})
	.superRefine((section, ctx) => {
		// `annex` and `kind: 'detail'` are orthogonal placements that may not both
		// be set: an annex section is in the flow and the TOC (end-matter the reader
		// scrolls to), a detail section is in neither (reachable only by an internal
		// link). A section carrying both has no coherent placement, so it is an
		// actionable FR2 error naming the offending section by id.
		if (section.annex === true && section.kind === 'detail') {
			ctx.addIssue({
				code: 'custom',
				message: `Section "${section.id}" sets both annex and kind: 'detail', but the two placements are mutually exclusive.`,
				path: ['kind'],
				params: {
					hint: 'An annex section is main-flow end-matter (in the flow and the TOC); a detail section is reachable only via an internal link (in neither). Drop one: remove annex for a detail page, or remove kind for an annex section.'
				}
			});
		}
	});

export type Section = z.infer<typeof sectionSchema>;
