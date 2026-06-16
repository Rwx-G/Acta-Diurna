import { z } from 'zod';
import { audiencesSchema, idSchema } from './shared.ts';

/**
 * Comparison Matrix block (Epic 7, Story 7.2): a findings-by-sources coverage
 * matrix whose formatting is computed from the document `scales`, not authored
 * per cell. The findings live ON this block (its content, not a document-level
 * registry); the Set-Membership block (7.4) references this block by id and
 * reads the same findings + severity/tag.
 *
 * Isomorphic by design: imports nothing from `$lib/server` or `$lib/ui`. The
 * block validates its own shape here; the cross-reference of `severityScale` /
 * `sourceScale` / `severity` / `sources` keys against the document `scales`
 * happens in the document-level pass (`scales.ts` `validateScaleReferences`),
 * because a block cannot see the document `scales` from inside the discriminated
 * union.
 */

/**
 * Per-source coverage state for a finding:
 *
 * - `found`: the source covers this finding (render tints the cell with the
 *   source's scale colour).
 * - `missing`: the source looked and did not find it (render fills the cell with
 *   a neutral hatched "missed" treatment, NOT a scale colour).
 * - `none`: the source was not run for this finding (render shows a neutral
 *   dash).
 */
export const sourceStateSchema = z.enum(['found', 'missing', 'none']);

export type SourceState = z.infer<typeof sourceStateSchema>;

export const sourceCellSchema = z.object({
	state: sourceStateSchema,
	text: z.string().max(2000, 'Source cell text too long: 2000 characters maximum.').optional()
});

export type SourceCell = z.infer<typeof sourceCellSchema>;

/**
 * Treatment disposition for a finding. A closed enum (unlike the author-defined
 * severity/source scales): `action` = remediation is due, `deferred` =
 * accepted/parked, `done` = resolved/closed. Render tints the treatment cells from
 * fixed theme tokens, never from a scale: action = the criticality tint, deferred =
 * neutral grey, done = a resolved green - so a remediation report doubles as an
 * execution tracker. `done` is additive: a document using only action/deferred
 * validates and renders unchanged.
 */
export const treatmentStatusSchema = z.enum(['action', 'deferred', 'done']);

export type TreatmentStatus = z.infer<typeof treatmentStatusSchema>;

/**
 * Optional per-block override for the two treatment column headers. Absent, the
 * renderer keeps its built-in "Before" / "After" labels (so existing documents are
 * byte-unchanged); present, both labels are author-supplied (e.g. "Current status" /
 * "Target") so the matrix can read as a status board rather than a before/after plan.
 */
export const treatmentLabelsSchema = z.object({
	before: z.string().min(1).max(100, 'Treatment label too long: 100 characters maximum.'),
	after: z.string().min(1).max(100, 'Treatment label too long: 100 characters maximum.')
});

export type TreatmentLabels = z.infer<typeof treatmentLabelsSchema>;

export const treatmentSchema = z.object({
	before: z.string().max(2000, 'Treatment-before too long: 2000 characters maximum.'),
	after: z.string().max(2000, 'Treatment-after too long: 2000 characters maximum.'),
	status: treatmentStatusSchema
});

export type Treatment = z.infer<typeof treatmentSchema>;

export const findingSchema = z.object({
	category: z.string().min(1).max(300, 'Finding category too long: 300 characters maximum.'),
	label: z.string().min(1).max(300, 'Finding label too long: 300 characters maximum.'),
	// An entry key in the severity scale (resolved in the document-level pass).
	severity: idSchema,
	// Keyed by an entry key in the sources scale. A finding need not carry a cell
	// for every source: a missing record key renders as `none`. Render always
	// iterates the sources-scale entry order for columns (not this record's own
	// key order), so every finding row aligns to the same columns.
	sources: z.record(idSchema, sourceCellSchema),
	treatment: treatmentSchema,
	// Optional short label. 7.4 renders each finding as a pill beside its
	// intersection and reads this `tag`; absent, 7.4 falls back to `label`.
	// Defined here so 7.4 needs no schema change. Forward-dependency, do not
	// repurpose.
	tag: z.string().min(1).max(100, 'Finding tag too long: 100 characters maximum.').optional(),
	// Optional internal link (Epic 11, Story 11.2): a section id in the same
	// document, rendered as an in-page anchor (`#<section-id>`) on the finding's
	// label so a finding drills down to its detail page. The target section's
	// existence is checked in the document-level cross-reference pass
	// (`validateInternalLinks`). Additive and optional: a finding without `linkTo`
	// renders byte-unchanged.
	linkTo: idSchema.optional()
});

export type Finding = z.infer<typeof findingSchema>;

/**
 * DoS cap on findings. A finding is one row; 500 rows stays well under the
 * table 10000-row cap and keeps SSR within NFR1. The source count per row is
 * bounded by the sources scale (`MAX_SCALE_ENTRIES = 24`), so the matrix is at
 * most 500 x 24 source cells.
 */
export const MAX_FINDINGS = 500;

export const comparisonMatrixBlockSchema = z.object({
	type: z.literal('comparison-matrix'),
	id: idSchema,
	audiences: audiencesSchema.optional(),
	// Document `scales` keys (resolved in the document-level pass).
	severityScale: idSchema,
	sourceScale: idSchema,
	// Optional override for the two treatment column headers (additive; absent keeps
	// the built-in "Before" / "After").
	treatmentLabels: treatmentLabelsSchema.optional(),
	findings: z
		.array(findingSchema)
		.min(1, 'A comparison matrix needs at least one finding.')
		.max(MAX_FINDINGS, 'Too many findings: 500 maximum.')
});

export type ComparisonMatrixBlock = z.infer<typeof comparisonMatrixBlockSchema>;
