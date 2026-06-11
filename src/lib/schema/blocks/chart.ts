import { z } from 'zod';
import { audiencesSchema, bindingSchema, idSchema, requireStaticDataOrBinding } from './shared.ts';

export const chartKindSchema = z.enum(['line', 'bar', 'area', 'pie']);

export type ChartKind = z.infer<typeof chartKindSchema>;

/** For pie charts, `x` carries the slice label and `y` its value. */
export const chartPointSchema = z.object({
	x: z.union([z.string().max(300, 'Point label too long: 300 characters maximum.'), z.number()]),
	y: z.number()
});

export type ChartPoint = z.infer<typeof chartPointSchema>;

export const chartSeriesSchema = z.object({
	name: z.string().min(1).max(300, 'Series name too long: 300 characters maximum.'),
	points: z.array(chartPointSchema).max(10000, 'Too many points in a series: 10000 maximum.')
});

export type ChartSeries = z.infer<typeof chartSeriesSchema>;

export const chartBlockSchema = z
	.object({
		type: z.literal('chart'),
		id: idSchema,
		audiences: audiencesSchema.optional(),
		kind: chartKindSchema,
		series: z
			.array(chartSeriesSchema)
			.min(1)
			.max(50, 'Too many chart series: 50 maximum.')
			.optional(),
		binding: bindingSchema.optional(),
		xAxisLabel: z
			.string()
			.min(1)
			.max(300, 'Axis label too long: 300 characters maximum.')
			.optional(),
		yAxisLabel: z
			.string()
			.min(1)
			.max(300, 'Axis label too long: 300 characters maximum.')
			.optional(),
		legendLabel: z
			.string()
			.min(1)
			.max(300, 'Legend label too long: 300 characters maximum.')
			.optional()
	})
	.superRefine(requireStaticDataOrBinding('series'));

export type ChartBlock = z.infer<typeof chartBlockSchema>;
