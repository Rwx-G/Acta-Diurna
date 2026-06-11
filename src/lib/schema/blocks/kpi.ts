import { z } from 'zod';
import { audiencesSchema, bindingSchema, idSchema, requireStaticDataOrBinding } from './shared.ts';

export const kpiTrendSchema = z.enum(['up', 'down', 'flat']);

export type KpiTrend = z.infer<typeof kpiTrendSchema>;

export const kpiItemSchema = z.object({
	label: z.string().min(1).max(300, 'KPI label too long: 300 characters maximum.'),
	value: z.union([z.string().max(300, 'KPI value too long: 300 characters maximum.'), z.number()]),
	unit: z.string().min(1).max(300, 'KPI unit too long: 300 characters maximum.').optional(),
	trend: kpiTrendSchema.optional()
});

export type KpiItem = z.infer<typeof kpiItemSchema>;

export const kpiBlockSchema = z
	.object({
		type: z.literal('kpi'),
		id: idSchema,
		audiences: audiencesSchema.optional(),
		items: z.array(kpiItemSchema).min(1).max(50, 'Too many KPI items: 50 maximum.').optional(),
		binding: bindingSchema.optional()
	})
	.superRefine(requireStaticDataOrBinding('items'));

export type KpiBlock = z.infer<typeof kpiBlockSchema>;
