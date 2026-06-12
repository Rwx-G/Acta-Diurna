import { z } from 'zod';
import { audiencesSchema, idSchema } from './shared.ts';

/**
 * Field Grid block (Epic 7, Story 7.3): a compact metadata grid of
 * `{ label, value }` pairs (e.g. Author / Date / Scope / Status) for a report
 * header. Author-written prose, NOT bound data: there is no `binding` field and
 * both `label` and `value` are plain bounded strings (single line, no rich
 * inline runs). If a later need arises to bind a value to a data set, that is an
 * additive `binding` extension then, not a speculative one now.
 *
 * Isomorphic by design: imports nothing from `$lib/server` or `$lib/ui`.
 */

/**
 * DoS cap on items. A metadata header is short; 24 is generous and consistent
 * with the bounded surface of the other Epic 7 blocks.
 */
export const MAX_FIELD_ITEMS = 24;

export const fieldItemSchema = z.object({
	label: z.string().min(1).max(200, 'Field label too long: 200 characters maximum.'),
	value: z.string().min(1).max(500, 'Field value too long: 500 characters maximum.')
});

export type FieldItem = z.infer<typeof fieldItemSchema>;

/**
 * Layout variant (Story 7.12). `grid` is the default two-column metadata grid;
 * `strip` is a horizontal, centred meta-strip of divided cells for a report
 * header (the correlation report's strip under the title). The field is additive
 * and OPTIONAL: a block with no `layout` (or `layout: 'grid'`) validates and
 * renders exactly as before, no schema-version bump and no new block type.
 */
export const fieldGridLayoutSchema = z.enum(['grid', 'strip']);

export type FieldGridLayout = z.infer<typeof fieldGridLayoutSchema>;

export const fieldGridBlockSchema = z.object({
	type: z.literal('field-grid'),
	id: idSchema,
	audiences: audiencesSchema.optional(),
	layout: fieldGridLayoutSchema.optional(),
	items: z
		.array(fieldItemSchema)
		.min(1, 'A field grid needs at least one item.')
		.max(MAX_FIELD_ITEMS, 'Too many field items: 24 maximum.')
});

export type FieldGridBlock = z.infer<typeof fieldGridBlockSchema>;
