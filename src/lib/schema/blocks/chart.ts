import { z } from 'zod';
import { audiencesSchema, bindingSchema, idSchema, requireStaticDataOrBinding } from './shared.ts';

export const chartKindSchema = z.enum(['line', 'bar', 'area', 'pie']);

export type ChartKind = z.infer<typeof chartKindSchema>;

/** For pie charts, `x` carries the slice label and `y` its value. */
export const chartPointSchema = z.object({
	x: z.union([z.string(), z.number()]),
	y: z.number()
});

export type ChartPoint = z.infer<typeof chartPointSchema>;

export const chartSeriesSchema = z.object({
	name: z.string().min(1),
	points: z.array(chartPointSchema)
});

export type ChartSeries = z.infer<typeof chartSeriesSchema>;

export const chartBlockSchema = z
	.object({
		type: z.literal('chart'),
		id: idSchema,
		audiences: audiencesSchema.optional(),
		kind: chartKindSchema,
		series: z.array(chartSeriesSchema).min(1).optional(),
		binding: bindingSchema.optional(),
		xAxisLabel: z.string().min(1).optional(),
		yAxisLabel: z.string().min(1).optional(),
		legendLabel: z.string().min(1).optional()
	})
	.superRefine(requireStaticDataOrBinding('series'));

export type ChartBlock = z.infer<typeof chartBlockSchema>;
