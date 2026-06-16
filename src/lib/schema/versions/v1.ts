import { z } from 'zod';
import { changeSummarySchema, idSchema } from '../blocks/shared.ts';
import { sectionSchema } from '../blocks/section.ts';
import { scalesSchema, validateScaleReferences } from '../scales.ts';
import { readerWidthSchema } from '../layout.ts';
import { validateInternalLinks } from '../internal-links.ts';
import { validateSectionIds } from '../section-ids.ts';
import { validateBlockIds } from '../block-ids.ts';

/** Document schema, version 1. The published contract (FR31, architecture D3). */
export const documentSchemaV1 = z
	.object({
		version: z.literal(1, 'Unsupported document schema version.'),
		title: z
			.string()
			.min(1, 'A document needs a title.')
			.max(300, 'Document title too long: 300 characters maximum.'),
		theme: idSchema.optional(),
		// Additive, optional reader max content width in CSS pixels. Absent = full-bleed
		// (the prior default); a number caps the reader column on /view and the published
		// reader. A document without it validates and renders unchanged; no version bump.
		width: readerWidthSchema.optional(),
		// Additive, optional (Epic 7). A document with no `scales` validates and
		// renders unchanged; no schema-version bump.
		scales: scalesSchema.optional(),
		// Additive, optional (Epic 9, Story 9.5). The opt-in reader-facing "changes
		// since the previous issue" summary: OFF by default (absent or `enabled:
		// false`), with the leak-safe `entries` baked at publish time. A document
		// without it validates and renders byte-unchanged; no schema-version bump.
		changeSummary: changeSummarySchema.optional(),
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
		// Section-id uniqueness pass (Epic 11 follow-up): a section id is the
		// primitive behind the `:target` detail reveal, deep-link resolution, and
		// presenter notes-by-id pairing, so a duplicate id silently misdirects a
		// drill-down or mis-pairs notes. Emitted before the internal-link pass so a
		// duplicate-id error reads clearly even when a `linkTo` also targets the
		// duplicated id (the internal link still resolves - the target exists - so
		// the duplicate-id issue is the one that names the real problem).
		for (const issue of validateSectionIds(document)) {
			ctx.addIssue({
				code: 'custom',
				message: issue.message,
				path: issue.path,
				params: { hint: issue.hint }
			});
		}
		// Block-id uniqueness pass (Epic 9+10 solidification): a block id is matched
		// document-wide by the series diff (`placeBlocks`), the delta bake
		// (`indexKpiByIdOf`), and the change-summary builder, all first-occurrence-wins.
		// A duplicate id silently drops the second block's delta and movement at publish
		// time, so it is rejected here as an FR2 problem-details error rather than left to
		// degrade silently. The twin of the section-id pass above.
		for (const issue of validateBlockIds(document)) {
			ctx.addIssue({
				code: 'custom',
				message: issue.message,
				path: issue.path,
				params: { hint: issue.hint }
			});
		}
		// Internal-link cross-reference pass (Epic 11, Story 11.2): a `linkTo` on an
		// inline run, a table row, or a comparison-matrix finding that names no
		// section id is a dangling reference, surfaced here as an FR2 problem-details
		// error so no document with a dead internal link is ever served.
		for (const issue of validateInternalLinks(document)) {
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
