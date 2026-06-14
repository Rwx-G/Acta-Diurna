import { z } from 'zod';

/**
 * Identifier rule for sections, blocks and theme references. Lowercase UUIDs
 * match the pattern too, so generated and hand-written ids share one rule.
 */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const idSchema = z
	.string()
	.max(300, 'Identifier too long: 300 characters maximum.')
	.regex(SLUG_PATTERN, 'Must be a slug: lowercase letters, digits and single hyphens.');

export const AUDIENCES = ['summary', 'full', 'technical'] as const;

export const audienceSchema = z.enum(AUDIENCES);

export type Audience = z.infer<typeof audienceSchema>;

/**
 * Audience tags drive the reader's summary / full / technical level switch.
 *
 * INVARIANT (audit-flagged): these tags are a presentation / reading-comfort
 * filter, NOT a confidentiality boundary. All audience levels render into the
 * authorized reader's DOM and are hidden only by CSS. Never gate confidential or
 * per-reader-restricted content behind an audience tag; the only author-private
 * field (section speaker notes) is stripped server-side before a reader sees it.
 */
export const audiencesSchema = z
	.array(audienceSchema)
	.max(AUDIENCES.length, `Too many audience tags: ${AUDIENCES.length} maximum.`);

/**
 * The render slot a bound field feeds, per block type (the canonical 2.4
 * binding-to-slot contract consumed by the resolver and Epic 2.5 auto-rebind):
 *
 * - `column` (table): the field becomes a table column. `key` is the column
 *   key the row record uses; `order` sets the left-to-right column position.
 * - `x` (chart): the category/time axis. Exactly one field per chart binding.
 * - `y` (chart): a value series plotted against `x`. Several `y` fields produce
 *   several series; `seriesName` overrides the series label (defaults to the
 *   field name).
 * - `value` (kpi): the field whose first row feeds the KPI value.
 * - `label` (kpi): the field whose first row feeds the KPI label (defaults to
 *   the field name when absent).
 *
 * Every member is optional so a schema-v1 document written before this contract
 * (a binding with no `slot` on its fields) still validates unchanged.
 */
export const SLOT_ROLES = ['column', 'x', 'y', 'value', 'label'] as const;

export const bindingSlotSchema = z.object({
	role: z.enum(SLOT_ROLES),
	/** Column key for `role: 'column'`; ignored for other roles. */
	key: z.string().min(1).max(300, 'Slot key too long: 300 characters maximum.').optional(),
	/** Column order for `role: 'column'`; lower comes first. */
	order: z.number().int().min(0).max(1000, 'Slot order out of range: 0-1000.').optional(),
	/** Series label for `role: 'y'`; defaults to the field name. */
	seriesName: z.string().min(1).max(300, 'Series name too long: 300 characters maximum.').optional()
});

export type BindingSlot = z.infer<typeof bindingSlotSchema>;

export const bindingFieldSchema = z.object({
	name: z.string().min(1).max(300, 'Field name too long: 300 characters maximum.'),
	type: z.enum(['string', 'number', 'date', 'boolean']),
	/**
	 * Optional render-slot mapping (2.4, additive). Absent on legacy bindings and
	 * on placeholder bindings authored before an upload; present once a field is
	 * bound to a block slot. The resolver and 2.5 auto-rebind read this.
	 */
	slot: bindingSlotSchema.optional()
});

export type BindingField = z.infer<typeof bindingFieldSchema>;

/**
 * The numeric movement of a bound value against the same value in the previous
 * issue of the series (Story 9.4). Direction is `up` / `down` / `flat` against the
 * prior issue's value; `absolute` is the signed change (now minus prior); `relative`
 * is the signed fraction of the prior value (e.g. `0.08` for +8%), null when the
 * prior value is zero (no meaningful percentage) so a renderer omits the percent
 * rather than dividing by zero. `priorValue` is the predecessor's numeric value, the
 * baseline the figure is measured against.
 */
export const bindingDeltaDirectionSchema = z.enum(['up', 'down', 'flat']);

export type BindingDeltaDirection = z.infer<typeof bindingDeltaDirectionSchema>;

export const bindingDeltaSchema = z.object({
	direction: bindingDeltaDirectionSchema,
	// `.finite()` rejects NaN / Infinity: the bake only ever writes finite values
	// (`computeBindingDelta` gates on `Number.isFinite`), so this guards a hand-authored
	// or externally-produced snapshot from a non-finite figure the renderer would print
	// as "∞" - breaking the omit-rather-than-mislead invariant.
	priorValue: z.number().finite(),
	absolute: z.number().finite(),
	/** Signed fraction of the prior value; null when the prior value is zero. */
	relative: z.number().finite().nullable()
});

export type BindingDelta = z.infer<typeof bindingDeltaSchema>;

/**
 * One headline data movement in the reader-facing change summary (Story 9.5): a
 * single KPI figure that moved against the previous issue, carried by the SAME
 * already-baked {@link BindingDelta} the renderer reads off the binding. It carries
 * NO prior-issue raw data - only the leak-safe delta facts (direction, signed
 * change) the reader is already served on the block itself, plus the block's own
 * label - so surfacing it in the summary ships nothing new to the reader.
 *
 * `label` is the KPI item's own label (already in the reader's DOM); `delta` is the
 * baked movement (already on the binding). Both are reader-visible by construction,
 * so the summary is a re-presentation of facts the reader already has, never a leak.
 *
 * `audiences` is the leak-safe audience tag set the renderer puts on the movement's
 * own element, so the SAME reader CSS that hides the block hides its movement line: a
 * movement is hidden at a level when EITHER its section OR its block is hidden there.
 * It is the intersection of the section's tags and the block's own tags (a level shows
 * the movement only when both show it), so a KPI tagged `technical` inside a section
 * visible at `summary` never surfaces its figure at `summary` - the summary cannot
 * contradict the body at the same level. Absent when both the section and the block
 * are untagged (the movement then shows at every level, like its block).
 */
export const changeSummaryMovementSchema = z.object({
	label: z.string().min(1).max(300, 'Movement label too long: 300 characters maximum.'),
	delta: bindingDeltaSchema,
	audiences: audiencesSchema.optional()
});

export type ChangeSummaryMovement = z.infer<typeof changeSummaryMovementSchema>;

/** The structural verdict a change-summary entry surfaces: a section appeared, vanished, or changed. */
export const changeSummaryVerdictSchema = z.enum(['added', 'removed', 'updated']);

export type ChangeSummaryVerdict = z.infer<typeof changeSummaryVerdictSchema>;

/**
 * One entry in the reader-facing change summary (Story 9.5): a section that was
 * added, removed, or updated since the previous issue, plus any headline data
 * movements under it. Each entry mirrors the SECTION's own audience tags so the
 * reader CSS hides a summary line that references a section hidden at the reader's
 * level - the same `data-audiences` mechanism that hides the section itself, so the
 * summary never references a section the reader's level conceals (AC2).
 *
 * The entry carries only leak-safe facts: the section id and title (already in the
 * reader's TOC), the structural verdict (a flag, never prior prose), the section's
 * audience tags (already on the rendered section), and the baked headline movements
 * (already on each KPI binding). No prior-issue raw content, no speaker notes, no
 * draft content - nothing the reader is not already served on the report itself.
 */
export const changeSummaryEntrySchema = z.object({
	sectionId: idSchema,
	sectionTitle: z
		.string()
		.min(1, 'A change-summary entry needs a section title.')
		.max(300, 'Section title too long: 300 characters maximum.'),
	change: changeSummaryVerdictSchema,
	audiences: audiencesSchema.optional(),
	movements: z
		.array(changeSummaryMovementSchema)
		.max(50, 'Too many headline movements in a change-summary entry: 50 maximum.')
		.optional()
});

export type ChangeSummaryEntry = z.infer<typeof changeSummaryEntrySchema>;

/**
 * The optional, opt-in reader-facing "changes since the previous issue" summary
 * (Story 9.5). `enabled` is the author's opt-in, OFF by default: a document without
 * this field, or with `enabled: false`, renders byte-unchanged and shows no panel.
 *
 * `entries` is the leak-safe summary BAKED at publish time, server-side, from the
 * `SeriesDiff` against the predecessor's published snapshot (the same precompute
 * pattern as the `binding.delta`): the platform computes the diff, distills it to a
 * sections-plus-headline-movements summary carrying only reader-visible facts, and
 * freezes it here so the PURE renderer reads it straight off the validated document
 * (no `$lib/server`, no client compute, no prior-issue raw data). `entries` is absent
 * when there is no predecessor (a first issue), the predecessor is unpublished, or the
 * pair drifted substantially - the omit-rather-than-mislead rule, so the panel simply
 * does not appear. Additive and optional throughout: no schema-version bump.
 */
export const changeSummarySchema = z.object({
	enabled: z.boolean(),
	entries: z
		.array(changeSummaryEntrySchema)
		.max(200, 'Too many change-summary entries: 200 maximum.')
		.optional()
});

export type ChangeSummary = z.infer<typeof changeSummarySchema>;

/**
 * Declares the fields a data-bound block expects so ingestion (Epic 2) can
 * resolve uploaded data against them. `dataSetId` stays optional until
 * uploads exist (Epic 2).
 *
 * `dataAsOf` is the FR16 data-freshness timestamp (Story 6.4), an ISO-8601
 * datetime stamped onto the binding at bind/rebind time: the bound data set's
 * explicit `data_as_of` when set, otherwise its injection time. It is baked here,
 * server-side, because the renderer is pure (no `$lib/server`, no DB) - so the
 * "Data as of <date>" caption reads it straight off the validated document. It
 * stays optional: a binding authored before an upload, or a data set with no
 * usable timestamp, simply carries none and the caption is omitted (never a
 * misleading date).
 *
 * `delta` is the Story 9.4 numeric movement against the previous issue, baked here
 * server-side at publish time exactly like `dataAsOf` is at bind time: the platform
 * compares this issue's resolved bound value to the id-matched block in the
 * predecessor's published snapshot and freezes the resulting delta onto the binding,
 * so the pure renderer reads the arrow + figure straight off the validated document
 * (no `$lib/server`, no client compute, and the prior issue's raw data never reaches
 * the reader - only the computed delta). It stays optional and additive: a first
 * issue, an unpublished predecessor, a non-numeric or unmatched value, simply carries
 * no `delta` and the indicator is omitted (never a misleading or zero delta).
 */
export const bindingSchema = z.object({
	dataSetId: z.string().min(1).max(300, 'Data set id too long: 300 characters maximum.').optional(),
	dataAsOf: z.iso.datetime({ offset: true }).optional(),
	delta: bindingDeltaSchema.optional(),
	fields: z.array(bindingFieldSchema).min(1).max(100, 'Too many binding fields: 100 maximum.')
});

export type Binding = z.infer<typeof bindingSchema>;

/** The static-data field of each data-bound block type. */
export type StaticDataKey = 'rows' | 'series' | 'items';

/**
 * Data-bound blocks need static content, a `binding`, or both: static data
 * supports authoring without uploads, a binding declares expectations for
 * refill-time resolution.
 */
export function requireStaticDataOrBinding(
	staticKey: StaticDataKey
): (
	block: Partial<Record<StaticDataKey | 'binding', unknown>>,
	ctx: z.core.$RefinementCtx
) => void {
	return (block, ctx) => {
		if (block[staticKey] === undefined && block.binding === undefined) {
			ctx.addIssue({
				code: 'custom',
				message: `Provide static ${staticKey} or a data binding.`,
				path: [staticKey],
				params: {
					hint: `Add inline ${staticKey} for static content, or a binding declaring the expected fields.`
				}
			});
		}
	};
}
