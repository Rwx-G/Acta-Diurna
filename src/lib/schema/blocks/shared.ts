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
 */
export const bindingSchema = z.object({
	dataSetId: z.string().min(1).max(300, 'Data set id too long: 300 characters maximum.').optional(),
	dataAsOf: z.iso.datetime({ offset: true }).optional(),
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
