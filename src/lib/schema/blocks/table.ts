import { z } from 'zod';
import { audiencesSchema, bindingSchema, idSchema, requireStaticDataOrBinding } from './shared.ts';

export const tableCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export type TableCell = z.infer<typeof tableCellSchema>;

export const tableColumnSchema = z.object({
	key: z.string().min(1),
	label: z.string().min(1)
});

export type TableColumn = z.infer<typeof tableColumnSchema>;

export const tableBlockSchema = z
	.object({
		type: z.literal('table'),
		id: idSchema,
		audiences: audiencesSchema.optional(),
		columns: z.array(tableColumnSchema).min(1),
		rows: z.array(z.record(z.string(), tableCellSchema)).optional(),
		binding: bindingSchema.optional(),
		options: z
			.object({
				stickyHeader: z.boolean().default(true)
			})
			.optional()
	})
	.superRefine(requireStaticDataOrBinding('rows'));

export type TableBlock = z.infer<typeof tableBlockSchema>;
