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

/** Audience tags are accepted and typed in v1; audience-aware rendering ships in P2. */
export const audiencesSchema = z
	.array(audienceSchema)
	.max(AUDIENCES.length, `Too many audience tags: ${AUDIENCES.length} maximum.`);

export const bindingFieldSchema = z.object({
	name: z.string().min(1).max(300, 'Field name too long: 300 characters maximum.'),
	type: z.enum(['string', 'number', 'date', 'boolean'])
});

export type BindingField = z.infer<typeof bindingFieldSchema>;

/**
 * Declares the fields a data-bound block expects so ingestion (Epic 2) can
 * resolve uploaded data against them. `dataSetId` stays optional until
 * uploads exist (Epic 2).
 */
export const bindingSchema = z.object({
	dataSetId: z.string().min(1).max(300, 'Data set id too long: 300 characters maximum.').optional(),
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
