import { z } from 'zod';
import { audiencesSchema, idSchema } from './shared.ts';
import { iconNameSchema } from '../icons.ts';

/**
 * Card Grid block (Epic 7, Story 7.9): a responsive grid of icon + title +
 * description cards, the "vision / benefits" summary that presents a set of
 * takeaways, features or highlights without a table or prose. Each card carries
 * an OPTIONAL `icon` (the 7.6 registry, by name), a bold `title` and a short,
 * one-line `description` - author-written prose, NOT bound data: there is no
 * `binding` field and both strings are plain bounded text (no rich inline runs).
 *
 * The optional `icon` reuses the 7.6 enum by name; an unknown name fails the
 * enum with the valid set as its hint (FR2 parity). The icon is decorative at
 * render (`aria-hidden` from 7.6): the title and description carry the meaning,
 * so the icon is never the sole signal (NFR14). A card with no icon renders
 * title + description only.
 *
 * `columns` is the desktop column count (1..MAX_CARD_COLUMNS); the renderer
 * collapses to a single column at the reader mobile breakpoint via CSS only.
 *
 * Isomorphic by design: this module imports nothing from `$lib/server` or
 * `$lib/ui`.
 */

/**
 * Desktop column ceiling. Beyond four columns the cards crowd the reader
 * column; 1..4 covers the "vision / benefits" layouts without a runaway grid.
 */
export const MAX_CARD_COLUMNS = 4;

/**
 * DoS cap on items, consistent with the bounded surface of the other Epic 7
 * blocks (the field grid caps at the same 24).
 */
export const MAX_CARD_ITEMS = 24;

export const cardItemSchema = z.object({
	// Optional glyph from the 7.6 icon registry, by name. An unknown name fails
	// the enum with the valid set as its hint (FR2 parity).
	icon: iconNameSchema.optional(),
	title: z
		.string()
		.min(1, 'A card needs a title.')
		.max(200, 'Card title too long: 200 characters maximum.'),
	description: z
		.string()
		.min(1, 'A card needs a description.')
		.max(500, 'Card description too long: 500 characters maximum.')
});

export type CardItem = z.infer<typeof cardItemSchema>;

export const cardGridBlockSchema = z.object({
	type: z.literal('card-grid'),
	id: idSchema,
	audiences: audiencesSchema.optional(),
	// Desktop column count; the renderer collapses to one column on mobile.
	columns: z
		.int()
		.min(1, 'A card grid needs at least one column.')
		.max(MAX_CARD_COLUMNS, 'Too many card columns: 4 maximum.'),
	items: z
		.array(cardItemSchema)
		.min(1, 'A card grid needs at least one card.')
		.max(MAX_CARD_ITEMS, 'Too many cards: 24 maximum.')
});

export type CardGridBlock = z.infer<typeof cardGridBlockSchema>;
