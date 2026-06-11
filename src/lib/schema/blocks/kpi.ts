import { z } from 'zod';
import { audiencesSchema, bindingSchema, idSchema, requireStaticDataOrBinding } from './shared.ts';

export const kpiTrendSchema = z.enum(['up', 'down', 'flat']);

export type KpiTrend = z.infer<typeof kpiTrendSchema>;

export const kpiItemSchema = z.object({
	label: z.string().min(1),
	value: z.union([z.string(), z.number()]),
	unit: z.string().min(1).optional(),
	trend: kpiTrendSchema.optional()
});

export type KpiItem = z.infer<typeof kpiItemSchema>;

export const kpiBlockSchema = z
	.object({
		type: z.literal('kpi'),
		id: idSchema,
		audiences: audiencesSchema.optional(),
		items: z.array(kpiItemSchema).min(1).optional(),
		binding: bindingSchema.optional()
	})
	.superRefine(requireStaticDataOrBinding('items'));

export type KpiBlock = z.infer<typeof kpiBlockSchema>;
