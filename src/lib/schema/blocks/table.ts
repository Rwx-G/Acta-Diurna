import { z } from 'zod';
import { audiencesSchema, bindingSchema, idSchema, requireStaticDataOrBinding } from './shared.ts';

export const tableCellSchema = z.union([
	z.string().max(5000, 'Cell text too long: 5000 characters maximum.'),
	z.number(),
	z.boolean(),
	z.null()
]);

export type TableCell = z.infer<typeof tableCellSchema>;

export const tableColumnSchema = z.object({
	key: z.string().min(1).max(300, 'Column key too long: 300 characters maximum.'),
	label: z.string().min(1).max(300, 'Column label too long: 300 characters maximum.'),
	// Optional conditional formatting (Epic 7, Story 7.5): a document `scales` key.
	// When set, this column's cells render as scale-driven badges (colour + label
	// computed at render from the scale entry whose key the cell value matches),
	// instead of plain text. Additive and optional: a column with no `scaleRef`
	// renders byte-identically to before. The `scaleRef` and every cell value in
	// the column are cross-referenced against the document `scales` in the
	// document-level pass (`scales.ts` `validateScaleReferences`).
	scaleRef: idSchema.optional()
});

export type TableColumn = z.infer<typeof tableColumnSchema>;

export const tableBlockSchema = z
	.object({
		type: z.literal('table'),
		id: idSchema,
		audiences: audiencesSchema.optional(),
		columns: z.array(tableColumnSchema).min(1).max(100, 'Too many table columns: 100 maximum.'),
		rows: z
			.array(
				z.record(z.string().max(300, 'Row key too long: 300 characters maximum.'), tableCellSchema)
			)
			.max(10000, 'Too many table rows: 10000 maximum.')
			.optional(),
		// Per-row internal links (Epic 11, Story 11.2): an array PARALLEL to `rows`,
		// where `rowLinks[i]` is the optional `linkTo` (a section id in the same
		// document) for row `i`; an absent or `null`/undefined slot is an un-linked
		// row. Kept beside `rows` rather than inside the row record so the row stays a
		// flat data record (the shape ingestion fills), so this is fully additive and
		// an existing table renders byte-identically. The target section's existence
		// is checked in the document-level cross-reference pass
		// (`validateInternalLinks`). Optional, so a table without `rowLinks` is
		// unchanged.
		rowLinks: z
			.array(idSchema.nullable())
			.max(10000, 'Too many row links: 10000 maximum.')
			.optional(),
		binding: bindingSchema.optional(),
		options: z
			.object({
				stickyHeader: z.boolean().default(true)
			})
			.optional()
	})
	.superRefine(requireStaticDataOrBinding('rows'))
	.superRefine((block, ctx) => {
		// Column keys index the row records (`row[column.key]`), so two columns
		// sharing a key collapse to one cell per row: every cell for the second
		// column overwrites the first, silently clobbering data the editor cannot
		// recover. Nothing else in the schema enforces uniqueness (a row is a flat
		// `z.record`), so a duplicate-key table would VALIDATE and persist with the
		// loss baked in. Reject it here with the colliding key named, so the server
		// is the authority that turns a dup-key document into a 422 on save.
		const seen = new Set<string>();
		block.columns.forEach((column, index) => {
			if (seen.has(column.key)) {
				ctx.addIssue({
					code: 'custom',
					message: `Duplicate table column key "${column.key}": column keys must be unique.`,
					path: ['columns', index, 'key'],
					params: {
						hint: 'Two columns share this key, so their row cells collide. Give each column a distinct key.'
					}
				});
			}
			seen.add(column.key);
		});
	});

export type TableBlock = z.infer<typeof tableBlockSchema>;
