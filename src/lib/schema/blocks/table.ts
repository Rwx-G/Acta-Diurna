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
		binding: bindingSchema.optional(),
		options: z
			.object({
				stickyHeader: z.boolean().default(true)
			})
			.optional()
	})
	.superRefine(requireStaticDataOrBinding('rows'));

export type TableBlock = z.infer<typeof tableBlockSchema>;
