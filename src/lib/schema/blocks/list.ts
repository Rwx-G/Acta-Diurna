import { z } from 'zod';
import { audiencesSchema, idSchema } from './shared.ts';
import { paragraphSchema } from './text.ts';

/**
 * Structured list / steps block (Epic 7, Story 7.10): an ordered or unordered
 * list whose items each carry a bold lead `term`/title and an OPTIONAL rich-text
 * `description`. The `ordered` flag selects an `<ol>` (a numbered procedure or
 * steps list) or a `<ul>` (an unordered checklist or inventory), so remediation
 * procedures and checklists render as first-class blocks instead of ad-hoc prose.
 *
 * The schema carries NO per-item number: an ordered list's step numbering is the
 * native list ordinal at render, so reordering items renumbers automatically and
 * a hand-authored number can never drift from its position.
 *
 * Each item must carry AT LEAST ONE of `term` / `description` (an empty item is a
 * validation error). The `description` reuses the text block's rich-text
 * vocabulary (paragraphs of inline runs), the SAME marks the text and callout
 * blocks honour - bold/italic, the 7.8 inline-code chip, and http(s) links - so
 * the description renders escaped with no raw HTML.
 *
 * Isomorphic by design: this module imports nothing from `$lib/server` or
 * `$lib/ui`.
 */

/**
 * DoS cap on items: a procedure or checklist past 100 steps is a structural smell
 * (split it into sections), and the bound keeps a single block bounded.
 */
export const MAX_LIST_ITEMS = 100;

/** DoS cap on the rich-text description, mirroring the callout body ceiling. */
export const MAX_LIST_ITEM_PARAGRAPHS = 50;

export const listItemSchema = z
	.object({
		// The bold lead label for the item. Optional, but at least one of term /
		// description must be present (the refine below).
		term: z.string().min(1).max(200, 'List item term too long: 200 characters maximum.').optional(),
		// The optional rich-text body: paragraphs of inline runs, the SAME vocabulary
		// the text and callout blocks use, so the description renders escaped.
		description: z
			.array(paragraphSchema)
			.min(1, 'A list item description needs at least one paragraph.')
			.max(MAX_LIST_ITEM_PARAGRAPHS, 'Too many paragraphs in a list item: 50 maximum.')
			.optional()
	})
	.refine(
		(item) => item.term !== undefined || item.description !== undefined,
		'A list item needs a term or a description.'
	);

export type ListItem = z.infer<typeof listItemSchema>;

export const listBlockSchema = z.object({
	type: z.literal('list'),
	id: idSchema,
	audiences: audiencesSchema.optional(),
	// Selects an <ol> (numbered procedure / steps) when true, a <ul> otherwise.
	// The step numbering is the native list ordinal at render, never authored.
	ordered: z.boolean(),
	items: z
		.array(listItemSchema)
		.min(1, 'A list needs at least one item.')
		.max(MAX_LIST_ITEMS, 'Too many list items: 100 maximum.')
});

export type ListBlock = z.infer<typeof listBlockSchema>;
